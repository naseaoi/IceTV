import { randomUUID } from 'crypto';
import { mkdir, open, readFile, stat, unlink } from 'fs/promises';
import { dirname, resolve } from 'path';

const DEFAULT_CRON_LEASE_TTL_MS = 15 * 60 * 1000;
const MAX_ACQUIRE_ATTEMPTS = 4;

type LeasePayload = {
  owner: string;
  expiresAt: number;
};

type LeaseState = {
  exists: boolean;
  expired: boolean;
  owner?: string;
};

export type CronLeaseOptions = {
  path?: string | null;
  ttlMs?: number;
  now?: () => number;
  owner?: string;
};

export type CronLease = {
  isHeld: () => boolean;
  release: () => Promise<void>;
};

export function resolveCronLeasePath(
  configuredPath = process.env.CRON_LOCK_PATH,
): string | null {
  if (configuredPath !== undefined) {
    const trimmed = configuredPath.trim();
    return trimmed ? resolve(trimmed) : null;
  }

  return process.env.DOCKER_ENV === 'true' ? '/data/icetv-cron.lock' : null;
}

export async function acquireCronLease(
  options: CronLeaseOptions = {},
): Promise<CronLease | null> {
  const lockPath =
    options.path === undefined
      ? resolveCronLeasePath()
      : options.path
        ? resolve(options.path)
        : null;
  if (!lockPath) {
    return createNoopLease();
  }

  const ttlMs = readPositiveInteger(
    options.ttlMs ?? process.env.CRON_LOCK_TTL_MS,
    DEFAULT_CRON_LEASE_TTL_MS,
  );
  const now = options.now || Date.now;
  const owner = options.owner || randomUUID();

  await mkdir(dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      try {
        await writeLease(handle, { owner, expiresAt: now() + ttlMs });
      } catch (error) {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
        throw error;
      }

      return createFileLease({ handle, lockPath, owner, ttlMs, now });
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }

      const removed = await removeExpiredLease(lockPath, ttlMs, now());
      if (!removed) {
        return null;
      }
    }
  }

  return null;
}

function createNoopLease(): CronLease {
  return {
    isHeld: () => true,
    release: async () => {},
  };
}

function createFileLease({
  handle,
  lockPath,
  owner,
  ttlMs,
  now,
}: {
  handle: Awaited<ReturnType<typeof open>>;
  lockPath: string;
  owner: string;
  ttlMs: number;
  now: () => number;
}): CronLease {
  let held = true;
  let released = false;
  let renewal: Promise<void> | null = null;
  const heartbeat = setInterval(
    () => {
      if (!renewal) {
        renewal = renewLease()
          .catch(() => {
            held = false;
          })
          .finally(() => {
            renewal = null;
          });
      }
    },
    Math.max(100, Math.floor(ttlMs / 3)),
  );
  heartbeat.unref?.();

  async function renewLease() {
    if (released || !held) return;

    const state = await readLeaseState(lockPath, ttlMs, now());
    if (!state.exists || state.owner !== owner) {
      held = false;
      return;
    }

    await writeLease(handle, { owner, expiresAt: now() + ttlMs });
  }

  return {
    isHeld: () => held && !released,
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);

      if (renewal) {
        await renewal;
      }

      let ownsPath = false;
      try {
        const state = await readLeaseState(lockPath, ttlMs, now());
        ownsPath = state.owner === owner;
      } catch {
        ownsPath = false;
      }

      await handle.close().catch(() => {});
      if (ownsPath) {
        await unlink(lockPath).catch(() => {});
      }
      held = false;
    },
  };
}

async function writeLease(
  handle: Awaited<ReturnType<typeof open>>,
  payload: LeasePayload,
) {
  const content = JSON.stringify(payload);
  await handle.truncate(0);
  await handle.write(content, 0, 'utf8');
  await handle.truncate(Buffer.byteLength(content));
  await handle.sync();
}

async function removeExpiredLease(
  lockPath: string,
  ttlMs: number,
  now: number,
): Promise<boolean> {
  const state = await readLeaseState(lockPath, ttlMs, now);
  if (!state.exists) {
    return true;
  }
  if (!state.expired) {
    return false;
  }

  try {
    await unlink(lockPath);
    return true;
  } catch (error) {
    if (isFileMissingError(error)) {
      return true;
    }
    throw error;
  }
}

async function readLeaseState(
  lockPath: string,
  ttlMs: number,
  now: number,
): Promise<LeaseState> {
  let fileStat;
  try {
    fileStat = await stat(lockPath);
  } catch (error) {
    if (isFileMissingError(error)) {
      return { exists: false, expired: true };
    }
    throw error;
  }

  try {
    const content = await readFile(lockPath, 'utf8');
    const parsed = JSON.parse(content) as Partial<LeasePayload>;
    if (
      typeof parsed.owner === 'string' &&
      typeof parsed.expiresAt === 'number' &&
      Number.isFinite(parsed.expiresAt)
    ) {
      return {
        exists: true,
        expired: parsed.expiresAt <= now,
        owner: parsed.owner,
      };
    }
  } catch {
    return {
      exists: true,
      expired: fileStat.mtimeMs + ttlMs <= now,
    };
  }

  return {
    exists: true,
    expired: fileStat.mtimeMs + ttlMs <= now,
  };
}

function readPositiveInteger(
  value: number | string | undefined,
  fallback: number,
) {
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}

function isFileMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
