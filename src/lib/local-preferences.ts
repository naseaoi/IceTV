export const DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY = 'defaultAggregateSearch';
export const ENABLE_OPTIMIZATION_STORAGE_KEY = 'enableOptimization';
export const FLUID_SEARCH_STORAGE_KEY = 'fluidSearch';
export const LIVE_DIRECT_CONNECT_STORAGE_KEY = 'liveDirectConnect';
export const BLOCK_AD_STORAGE_KEY = 'enable_blockad';
export const PREFERRED_QUALITY_STORAGE_KEY = 'preferredQuality';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sidebarCollapsed';
export const SEEN_ANNOUNCEMENT_STORAGE_KEY = 'hasSeenAnnouncement';

function readStoredBoolean(key: string): boolean | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function resetStoredBoolean(key: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(key);
}

function readStoredString(key: string): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.localStorage.getItem(key) ?? undefined;
}

function writeStoredString(key: string, value: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, value);
}

export function readDefaultAggregateSearch(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.RUNTIME_CONFIG?.DEFAULT_AGGREGATE_SEARCH !== false;
}

export function readAggregateSearch(): boolean {
  return (
    readStoredBoolean(DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY) ??
    readDefaultAggregateSearch()
  );
}

export function writeAggregateSearch(value: boolean) {
  writeStoredBoolean(DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY, value);
}

export function resetAggregateSearch() {
  resetStoredBoolean(DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY);
}

export function readDefaultEnableOptimization(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.RUNTIME_CONFIG?.ENABLE_OPTIMIZATION !== false;
}

export function readEnableOptimization(): boolean {
  return (
    readStoredBoolean(ENABLE_OPTIMIZATION_STORAGE_KEY) ??
    readDefaultEnableOptimization()
  );
}

export function writeEnableOptimization(value: boolean) {
  writeStoredBoolean(ENABLE_OPTIMIZATION_STORAGE_KEY, value);
}

export function resetEnableOptimization() {
  resetStoredBoolean(ENABLE_OPTIMIZATION_STORAGE_KEY);
}

export function readDefaultFluidSearch(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  return window.RUNTIME_CONFIG?.FLUID_SEARCH !== false;
}

export function readFluidSearch(): boolean {
  return (
    readStoredBoolean(FLUID_SEARCH_STORAGE_KEY) ?? readDefaultFluidSearch()
  );
}

export function writeFluidSearch(value: boolean) {
  writeStoredBoolean(FLUID_SEARCH_STORAGE_KEY, value);
}

export function resetFluidSearch() {
  resetStoredBoolean(FLUID_SEARCH_STORAGE_KEY);
}

export function readDefaultLiveDirectConnect(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.RUNTIME_CONFIG?.LIVE_DIRECT_CONNECT === true;
}

export function readLiveDirectConnect(): boolean {
  return (
    readStoredBoolean(LIVE_DIRECT_CONNECT_STORAGE_KEY) ??
    readDefaultLiveDirectConnect()
  );
}

export function writeLiveDirectConnect(value: boolean) {
  writeStoredBoolean(LIVE_DIRECT_CONNECT_STORAGE_KEY, value);
}

export function resetLiveDirectConnect() {
  resetStoredBoolean(LIVE_DIRECT_CONNECT_STORAGE_KEY);
}

export function readBlockAdEnabled(): boolean {
  return readStoredBoolean(BLOCK_AD_STORAGE_KEY) ?? true;
}

export function writeBlockAdEnabled(value: boolean) {
  writeStoredBoolean(BLOCK_AD_STORAGE_KEY, value);
}

export function readSidebarCollapsed(): boolean {
  return readStoredBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY) ?? false;
}

export function writeSidebarCollapsed(value: boolean) {
  writeStoredBoolean(SIDEBAR_COLLAPSED_STORAGE_KEY, value);
}

export function readSeenAnnouncement(): string | undefined {
  return readStoredString(SEEN_ANNOUNCEMENT_STORAGE_KEY);
}

export function writeSeenAnnouncement(value: string) {
  writeStoredString(SEEN_ANNOUNCEMENT_STORAGE_KEY, value);
}

export function readPreferredQualityHeight(): number | null {
  const raw = readStoredString(PREFERRED_QUALITY_STORAGE_KEY);
  if (!raw || raw === 'auto') {
    return null;
  }
  const height = Number.parseInt(raw, 10);
  return Number.isFinite(height) && height > 0 ? height : null;
}

export function writePreferredQualityHeight(height: number | null) {
  writeStoredString(
    PREFERRED_QUALITY_STORAGE_KEY,
    height && height > 0 ? String(height) : 'auto',
  );
}
