'use client';

import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import {
  readSeenReleaseVersion,
  writeSeenReleaseVersion,
} from '@/lib/local-preferences';
import { compareReleaseVersions } from '@/lib/release-version';
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
  latestVersion?: string;
};

export interface ReleaseCheckResult {
  status: UpdateStatus;
  latestVersion: string | null;
}

let cachedCheckPromise: Promise<ReleaseCheckResult> | null = null;
let cachedCheckResult: CachedCheckResult | null = null;

export const RELEASE_SEEN_EVENT = 'icetv:release-seen';

// 站长在版本面板看过的版本不再挂红点，更新的版本发布后重新提醒
export async function checkForUnseenUpdate(): Promise<boolean> {
  const { status, latestVersion } = await checkLatestRelease();
  return (
    status === UpdateStatus.HAS_UPDATE &&
    !!latestVersion &&
    readSeenReleaseVersion() !== latestVersion
  );
}

export async function markLatestReleaseSeen(): Promise<void> {
  const { status, latestVersion } = await checkLatestRelease();
  if (status !== UpdateStatus.HAS_UPDATE || !latestVersion) return;
  if (readSeenReleaseVersion() === latestVersion) return;
  writeSeenReleaseVersion(latestVersion);
  window.dispatchEvent(new Event(RELEASE_SEEN_EVENT));
}

export async function checkLatestRelease(): Promise<ReleaseCheckResult> {
  const now = Date.now();
  const cached = resolveCachedResult(cachedCheckResult, now);
  if (cached) {
    return cached;
  }

  const stored = resolveCachedResult(readStoredCheckResult(), now);
  if (stored) {
    return stored;
  }

  if (cachedCheckPromise) {
    return cachedCheckPromise;
  }

  writeCheckResult({
    status: 'pending',
    checkedAt: now,
  });

  cachedCheckPromise = checkForUpdatesInternal()
    .then((result) => {
      writeCheckResult({
        status: result.status,
        checkedAt: Date.now(),
        ...(result.latestVersion
          ? { latestVersion: result.latestVersion }
          : {}),
      });
      return result;
    })
    .finally(() => {
      cachedCheckPromise = null;
    });

  return cachedCheckPromise;
}

function resolveCachedResult(
  result: CachedCheckResult | null,
  now: number,
): ReleaseCheckResult | null {
  if (!result) return null;
  const age = now - result.checkedAt;
  if (result.status === 'pending') {
    return age < FAILED_CHECK_RETRY_INTERVAL_MS
      ? { status: UpdateStatus.FETCH_FAILED, latestVersion: null }
      : null;
  }
  const ttl =
    result.status === UpdateStatus.FETCH_FAILED
      ? FAILED_CHECK_RETRY_INTERVAL_MS
      : SUCCESS_CHECK_CACHE_MS;
  return age < ttl
    ? { status: result.status, latestVersion: result.latestVersion ?? null }
    : null;
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
    return typeof data.latestVersion === 'string' && data.latestVersion
      ? { status, checkedAt, latestVersion: data.latestVersion }
      : { status, checkedAt };
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

async function checkForUpdatesInternal(): Promise<ReleaseCheckResult> {
  try {
    const remoteVersion = await fetchLatestVersion();
    if (!remoteVersion) {
      return { status: UpdateStatus.FETCH_FAILED, latestVersion: null };
    }

    return {
      status: compareVersions(remoteVersion),
      latestVersion: remoteVersion,
    };
  } catch (error) {
    console.error('版本检查失败:', error);
    return { status: UpdateStatus.FETCH_FAILED, latestVersion: null };
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
      typeof data?.latestVersion === 'string' ? data.latestVersion : '';
    return version.trim() || null;
  } catch {
    return null;
  } finally {
    abortState.cleanup();
  }
}

export function compareVersions(remoteVersion: string): UpdateStatus {
  const comparison = compareReleaseVersions(remoteVersion, CURRENT_VERSION);
  if (comparison === null) {
    return remoteVersion !== CURRENT_VERSION
      ? UpdateStatus.HAS_UPDATE
      : UpdateStatus.NO_UPDATE;
  }
  return comparison > 0 ? UpdateStatus.HAS_UPDATE : UpdateStatus.NO_UPDATE;
}
