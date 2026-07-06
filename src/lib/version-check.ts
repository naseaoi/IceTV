'use client';

import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import { CURRENT_VERSION } from '@/lib/version';

export enum UpdateStatus {
  HAS_UPDATE = 'has_update',
  NO_UPDATE = 'no_update',
  FETCH_FAILED = 'fetch_failed',
}

const VERSION_CHECK_TIMEOUT_MS = 5000;
const FAILED_CHECK_RETRY_INTERVAL_MS = 60_000;
const SUCCESS_CHECK_CACHE_MS = 12 * 60 * 60 * 1000;
const VERSION_CHECK_CACHE_KEY = 'icetv:version-check';

type StoredCheckStatus = UpdateStatus | 'pending';

type CachedCheckResult = {
  status: StoredCheckStatus;
  checkedAt: number;
};

let cachedCheckPromise: Promise<UpdateStatus> | null = null;
let cachedCheckResult: CachedCheckResult | null = null;

export async function checkForUpdates(): Promise<UpdateStatus> {
  const now = Date.now();
  const cachedStatus = resolveCachedStatus(cachedCheckResult, now);
  if (cachedStatus) {
    return cachedStatus;
  }

  const storedStatus = resolveCachedStatus(readStoredCheckResult(), now);
  if (storedStatus) {
    return storedStatus;
  }

  if (cachedCheckPromise) {
    return cachedCheckPromise;
  }

  writeCheckResult({
    status: 'pending',
    checkedAt: now,
  });

  cachedCheckPromise = checkForUpdatesInternal()
    .then((status) => {
      writeCheckResult({
        status,
        checkedAt: Date.now(),
      });
      return status;
    })
    .finally(() => {
      cachedCheckPromise = null;
    });

  return cachedCheckPromise;
}

function resolveCachedStatus(
  result: CachedCheckResult | null,
  now: number,
): UpdateStatus | null {
  if (!result) return null;
  const age = now - result.checkedAt;
  if (result.status === 'pending') {
    return age < FAILED_CHECK_RETRY_INTERVAL_MS
      ? UpdateStatus.FETCH_FAILED
      : null;
  }
  if (result.status === UpdateStatus.FETCH_FAILED) {
    return age < FAILED_CHECK_RETRY_INTERVAL_MS ? result.status : null;
  }
  return age < SUCCESS_CHECK_CACHE_MS ? result.status : null;
}

function readStoredCheckResult(): CachedCheckResult | null {
  if (typeof sessionStorage === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(VERSION_CHECK_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CachedCheckResult>;
    const status = data.status;
    const checkedAt = Number(data.checkedAt);
    if (
      status !== 'pending' &&
      status !== UpdateStatus.FETCH_FAILED &&
      status !== UpdateStatus.HAS_UPDATE &&
      status !== UpdateStatus.NO_UPDATE
    ) {
      return null;
    }
    if (!Number.isFinite(checkedAt)) return null;
    return { status, checkedAt };
  } catch {
    return null;
  }
}

function writeCheckResult(result: CachedCheckResult): void {
  cachedCheckResult = result;
  if (typeof sessionStorage === 'undefined') return;

  try {
    sessionStorage.setItem(VERSION_CHECK_CACHE_KEY, JSON.stringify(result));
  } catch {}
}

async function checkForUpdatesInternal(): Promise<UpdateStatus> {
  try {
    const remoteVersion = await fetchLatestVersion();
    if (!remoteVersion) {
      return UpdateStatus.FETCH_FAILED;
    }

    return compareVersions(remoteVersion);
  } catch (error) {
    console.error('版本检查失败:', error);
    return UpdateStatus.FETCH_FAILED;
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  const abortState = createTimedAbortController(
    undefined,
    VERSION_CHECK_TIMEOUT_MS,
  );

  try {
    const response = await fetch('/api/version/latest', {
      method: 'GET',
      signal: abortState.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const version =
      typeof data?.latestVersion === 'string'
        ? data.latestVersion
        : typeof data?.changelog?.[0]?.version === 'string'
          ? data.changelog[0].version
          : '';
    return version.trim() || null;
  } catch {
    return null;
  } finally {
    abortState.cleanup();
  }
}

export function compareVersions(remoteVersion: string): UpdateStatus {
  if (remoteVersion === CURRENT_VERSION) {
    return UpdateStatus.NO_UPDATE;
  }

  try {
    const currentParts = CURRENT_VERSION.split('.').map((part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0) {
        throw new Error(`无效的版本号格式: ${CURRENT_VERSION}`);
      }
      return num;
    });

    const remoteParts = remoteVersion.split('.').map((part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0) {
        throw new Error(`无效的版本号格式: ${remoteVersion}`);
      }
      return num;
    });

    const normalizeVersion = (parts: number[]) => {
      if (parts.length >= 3) {
        return parts.slice(0, 3);
      }
      const normalized = [...parts];
      while (normalized.length < 3) {
        normalized.push(0);
      }
      return normalized;
    };

    const normalizedCurrent = normalizeVersion(currentParts);
    const normalizedRemote = normalizeVersion(remoteParts);

    for (let i = 0; i < 3; i++) {
      if (normalizedRemote[i] > normalizedCurrent[i]) {
        return UpdateStatus.HAS_UPDATE;
      } else if (normalizedRemote[i] < normalizedCurrent[i]) {
        return UpdateStatus.NO_UPDATE;
      }
    }

    return UpdateStatus.NO_UPDATE;
  } catch (error) {
    console.error('版本号比较失败:', error);
    return remoteVersion !== CURRENT_VERSION
      ? UpdateStatus.HAS_UPDATE
      : UpdateStatus.NO_UPDATE;
  }
}
