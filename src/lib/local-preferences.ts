export const DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY = 'defaultAggregateSearch';
export const ENABLE_OPTIMIZATION_STORAGE_KEY = 'enableOptimization';
export const FLUID_SEARCH_STORAGE_KEY = 'fluidSearch';
export const LIVE_DIRECT_CONNECT_STORAGE_KEY = 'liveDirectConnect';

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

export function readDefaultAggregateSearch(): boolean {
  return true;
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
  return true;
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
  return false;
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
