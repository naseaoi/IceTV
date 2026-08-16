export const DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY = 'defaultAggregateSearch';
export const ENABLE_OPTIMIZATION_STORAGE_KEY = 'enableOptimization';
export const FLUID_SEARCH_STORAGE_KEY = 'fluidSearch';
export const LIVE_DIRECT_CONNECT_STORAGE_KEY = 'liveDirectConnect';
export const LIVE_DIRECT_CONNECT_CHANGE_EVENT =
  'icetv:live-direct-connect-change';
export const BLOCK_AD_STORAGE_KEY = 'enable_blockad';
export const AUTO_PLAY_NEXT_STORAGE_KEY = 'enable_autoplay_next';
export const PREFERRED_QUALITY_STORAGE_KEY = 'preferredQuality';
export const SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX = 'preferredQuality:';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sidebarCollapsed';
export const SEEN_ANNOUNCEMENT_STORAGE_KEY = 'hasSeenAnnouncement';
export const ADMIN_TABLE_COLUMN_WIDTHS_STORAGE_KEY = 'adminTableColumnWidths';
export const CONTINUE_WATCHING_COUNT_STORAGE_KEY = 'continueWatchingCount';

type AdminTableColumnWidths = Record<string, Record<string, number>>;

const ADMIN_TABLE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MIN_ADMIN_TABLE_COLUMN_WIDTH = 48;
const MAX_ADMIN_TABLE_COLUMN_WIDTH = 1200;

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

function isValidAdminTableId(value: string): boolean {
  return ADMIN_TABLE_ID_PATTERN.test(value);
}

function isValidAdminTableColumnWidth(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_ADMIN_TABLE_COLUMN_WIDTH &&
    value <= MAX_ADMIN_TABLE_COLUMN_WIDTH
  );
}

function readAdminTableColumnWidths(): AdminTableColumnWidths {
  const raw = readStoredString(ADMIN_TABLE_COLUMN_WIDTHS_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const widths: AdminTableColumnWidths = {};
    Object.entries(parsed).forEach(([tableId, columns]) => {
      if (
        !isValidAdminTableId(tableId) ||
        !columns ||
        typeof columns !== 'object' ||
        Array.isArray(columns)
      ) {
        return;
      }

      const validColumns: Record<string, number> = {};
      Object.entries(columns).forEach(([columnId, width]) => {
        if (
          isValidAdminTableId(columnId) &&
          isValidAdminTableColumnWidth(width)
        ) {
          validColumns[columnId] = Math.round(width);
        }
      });
      widths[tableId] = validColumns;
    });
    return widths;
  } catch {
    return {};
  }
}

export function readAdminTableColumnWidth(
  tableId: string,
  columnId: string,
): number | undefined {
  if (!isValidAdminTableId(tableId) || !isValidAdminTableId(columnId)) {
    return undefined;
  }
  return readAdminTableColumnWidths()[tableId]?.[columnId];
}

export function writeAdminTableColumnWidth(
  tableId: string,
  columnId: string,
  width: number,
): void {
  if (
    !isValidAdminTableId(tableId) ||
    !isValidAdminTableId(columnId) ||
    !isValidAdminTableColumnWidth(width)
  ) {
    return;
  }

  const widths = readAdminTableColumnWidths();
  widths[tableId] = {
    ...widths[tableId],
    [columnId]: Math.round(width),
  };
  writeStoredString(
    ADMIN_TABLE_COLUMN_WIDTHS_STORAGE_KEY,
    JSON.stringify(widths),
  );
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
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(LIVE_DIRECT_CONNECT_CHANGE_EVENT, {
        detail: value,
      }),
    );
  }
}

export function resetLiveDirectConnect() {
  resetStoredBoolean(LIVE_DIRECT_CONNECT_STORAGE_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LIVE_DIRECT_CONNECT_CHANGE_EVENT));
  }
}

export function readBlockAdEnabled(): boolean {
  return readStoredBoolean(BLOCK_AD_STORAGE_KEY) ?? true;
}

export function writeBlockAdEnabled(value: boolean) {
  writeStoredBoolean(BLOCK_AD_STORAGE_KEY, value);
}

export function readAutoPlayNextEnabled(): boolean {
  return readStoredBoolean(AUTO_PLAY_NEXT_STORAGE_KEY) ?? true;
}

export function writeAutoPlayNextEnabled(value: boolean) {
  writeStoredBoolean(AUTO_PLAY_NEXT_STORAGE_KEY, value);
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

export function readContinueWatchingCount(): number {
  const raw = readStoredString(CONTINUE_WATCHING_COUNT_STORAGE_KEY);
  const count = Number.parseInt(raw || '', 10);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

export function writeContinueWatchingCount(value: number): void {
  const count = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  try {
    writeStoredString(CONTINUE_WATCHING_COUNT_STORAGE_KEY, String(count));
  } catch {}
  try {
    if (typeof document !== 'undefined') {
      document.cookie = `cw_count=${count};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
    }
  } catch {}
}

export function resetContinueWatchingCount(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(CONTINUE_WATCHING_COUNT_STORAGE_KEY);
    }
  } catch {}
  try {
    if (typeof document !== 'undefined') {
      document.cookie = 'cw_count=0;path=/;max-age=0;samesite=lax';
    }
  } catch {}
}

export function readPreferredQualityHeight(): number | null {
  const raw = readStoredString(PREFERRED_QUALITY_STORAGE_KEY);
  if (!raw || raw === 'auto') {
    return null;
  }
  const height = Number.parseInt(raw, 10);
  return Number.isFinite(height) && height > 0 ? height : null;
}

export type PreferredQualityPreference =
  | { mode: 'default' }
  | { mode: 'auto' }
  | { mode: 'manual'; height: number };

function parsePreferredQualityPreference(
  raw: string | undefined,
): PreferredQualityPreference {
  if (!raw) {
    return { mode: 'default' };
  }
  if (raw === 'auto') {
    return { mode: 'auto' };
  }
  const height = Number.parseInt(raw, 10);
  return Number.isFinite(height) && height > 0
    ? { mode: 'manual', height }
    : { mode: 'default' };
}

function getSourcePreferredQualityStorageKey(sourceKey: string): string | null {
  const normalizedSourceKey = sourceKey.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(normalizedSourceKey)) {
    return null;
  }
  return `${SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX}${normalizedSourceKey}`;
}

export function readPreferredQualityPreference(): PreferredQualityPreference {
  return parsePreferredQualityPreference(
    readStoredString(PREFERRED_QUALITY_STORAGE_KEY),
  );
}

export function writePreferredQualityHeight(height: number | null) {
  writeStoredString(
    PREFERRED_QUALITY_STORAGE_KEY,
    height && height > 0 ? String(height) : 'auto',
  );
}

export function readSourcePreferredQualityPreference(
  sourceKey: string,
): PreferredQualityPreference {
  const storageKey = getSourcePreferredQualityStorageKey(sourceKey);
  if (!storageKey) {
    return { mode: 'default' };
  }
  const sourcePreference = readStoredString(storageKey);
  if (sourcePreference !== undefined) {
    return parsePreferredQualityPreference(sourcePreference);
  }
  if (sourceKey === 'xigua') {
    return readPreferredQualityPreference();
  }
  return { mode: 'default' };
}

export function writeSourcePreferredQualityHeight(
  sourceKey: string,
  height: number | null,
): void {
  const storageKey = getSourcePreferredQualityStorageKey(sourceKey);
  if (!storageKey) {
    return;
  }
  writeStoredString(storageKey, height && height > 0 ? String(height) : 'auto');
}
