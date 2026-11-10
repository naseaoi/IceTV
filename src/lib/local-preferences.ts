import {
  readStorage,
  removeStorage,
  writeStorage,
} from '@/lib/browser-storage';
import {
  clearListCountCookie,
  readListCountCookie,
  writeListCountCookie,
} from '@/lib/list-count-cookies';

export const DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY = 'defaultAggregateSearch';
export const ENABLE_OPTIMIZATION_STORAGE_KEY = 'enableOptimization';
export const FLUID_SEARCH_STORAGE_KEY = 'fluidSearch';
export const LIVE_DIRECT_CONNECT_STORAGE_KEY = 'liveDirectConnect';
export const LIVE_DIRECT_CONNECT_CHANGE_EVENT =
  'icetv:live-direct-connect-change';
export const AUTO_SWITCH_SOURCE_STORAGE_KEY = 'autoSwitchSource';
export const BLOCK_AD_STORAGE_KEY = 'enable_blockad';
export const AUTO_PLAY_NEXT_STORAGE_KEY = 'enable_autoplay_next';
export const PREFERRED_QUALITY_STORAGE_KEY = 'preferredQuality';
export const SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX = 'preferredQuality:';
export const SEEN_ANNOUNCEMENT_STORAGE_KEY = 'hasSeenAnnouncement';
export const NOTIFIED_RELEASE_VERSION_STORAGE_KEY = 'notifiedReleaseVersion';
export const NOTIFIED_MESSAGE_REVISION_STORAGE_PREFIX =
  'notifiedMessageRevision:';
export const DANMAKU_ENABLED_STORAGE_KEY = 'danmakuEnabled';
export const DANMAKU_OPACITY_STORAGE_KEY = 'danmakuOpacity';
export const DANMAKU_FONT_SIZE_STORAGE_KEY = 'danmakuFontSize';
export const DANMAKU_HEATMAP_STORAGE_KEY = 'danmakuHeatmap';
export const DANMAKU_OFFSET_STORAGE_PREFIX = 'danmakuOffset:';
export const DANMAKU_EPISODE_MAP_STORAGE_PREFIX = 'danmakuEpisode:';
export const DANMAKU_EPISODE_SEARCH_STORAGE_PREFIX = 'danmakuEpisodeSearch:';

function readStoredBoolean(key: string): boolean | undefined {
  const raw = readStorage(key);
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
  return writeStorage(key, JSON.stringify(value));
}

function resetStoredBoolean(key: string) {
  return removeStorage(key);
}

function readStoredString(key: string): string | undefined {
  return readStorage(key) ?? undefined;
}

function writeStoredString(key: string, value: string) {
  return writeStorage(key, value);
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
  return writeStoredBoolean(DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY, value);
}

export function resetAggregateSearch() {
  return resetStoredBoolean(DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY);
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
  return writeStoredBoolean(ENABLE_OPTIMIZATION_STORAGE_KEY, value);
}

export function resetEnableOptimization() {
  return resetStoredBoolean(ENABLE_OPTIMIZATION_STORAGE_KEY);
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
  return writeStoredBoolean(FLUID_SEARCH_STORAGE_KEY, value);
}

export function resetFluidSearch() {
  return resetStoredBoolean(FLUID_SEARCH_STORAGE_KEY);
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
  const saved = writeStoredBoolean(LIVE_DIRECT_CONNECT_STORAGE_KEY, value);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(LIVE_DIRECT_CONNECT_CHANGE_EVENT, {
        detail: value,
      }),
    );
  }
  return saved;
}

export function resetLiveDirectConnect() {
  const saved = resetStoredBoolean(LIVE_DIRECT_CONNECT_STORAGE_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LIVE_DIRECT_CONNECT_CHANGE_EVENT));
  }
  return saved;
}

export function readDefaultAutoSwitchSource(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.RUNTIME_CONFIG?.AUTO_SWITCH_SOURCE === true;
}

export function readAutoSwitchSource(): boolean {
  return (
    readStoredBoolean(AUTO_SWITCH_SOURCE_STORAGE_KEY) ??
    readDefaultAutoSwitchSource()
  );
}

export function writeAutoSwitchSource(value: boolean) {
  return writeStoredBoolean(AUTO_SWITCH_SOURCE_STORAGE_KEY, value);
}

export function resetAutoSwitchSource() {
  return resetStoredBoolean(AUTO_SWITCH_SOURCE_STORAGE_KEY);
}

export function readBlockAdEnabled(): boolean {
  return readStoredBoolean(BLOCK_AD_STORAGE_KEY) ?? true;
}

export function writeBlockAdEnabled(value: boolean) {
  return writeStoredBoolean(BLOCK_AD_STORAGE_KEY, value);
}

export function readAutoPlayNextEnabled(): boolean {
  return readStoredBoolean(AUTO_PLAY_NEXT_STORAGE_KEY) ?? true;
}

export function writeAutoPlayNextEnabled(value: boolean) {
  return writeStoredBoolean(AUTO_PLAY_NEXT_STORAGE_KEY, value);
}

export function readSeenAnnouncement(): string | undefined {
  return readStoredString(SEEN_ANNOUNCEMENT_STORAGE_KEY);
}

export function writeSeenAnnouncement(value: string) {
  return writeStoredString(SEEN_ANNOUNCEMENT_STORAGE_KEY, value);
}

export function readNotifiedReleaseVersion(): string | undefined {
  return readStoredString(NOTIFIED_RELEASE_VERSION_STORAGE_KEY);
}

export function writeNotifiedReleaseVersion(version: string) {
  return writeStoredString(NOTIFIED_RELEASE_VERSION_STORAGE_KEY, version);
}

function getNotifiedMessageRevisionStorageKey(username: string): string | null {
  const normalized = username.trim();
  if (!normalized) {
    return null;
  }
  return `${NOTIFIED_MESSAGE_REVISION_STORAGE_PREFIX}${normalized}`;
}

export function readNotifiedMessageRevision(
  username: string,
): string | undefined {
  const storageKey = getNotifiedMessageRevisionStorageKey(username);
  return storageKey ? readStoredString(storageKey) : undefined;
}

export function writeNotifiedMessageRevision(
  username: string,
  revision: string,
): void {
  const storageKey = getNotifiedMessageRevisionStorageKey(username);
  if (!storageKey) {
    return;
  }
  try {
    writeStoredString(storageKey, revision);
  } catch {}
}

// 列表计数只存在不区分账号的 cookie 中，登录时由服务端覆盖、退出时清除，不再落 localStorage
export function readContinueWatchingCount(): number {
  return readListCountCookie('cw_count') ?? 0;
}

export function writeContinueWatchingCount(value: number): void {
  writeListCountCookie('cw_count', value);
}

export function readContinueWatchingPageCount(): number {
  return readListCountCookie('cw_page_count') ?? 0;
}

export function writeContinueWatchingPageCount(value: number): void {
  writeListCountCookie('cw_page_count', value);
}

export function resetContinueWatchingPageCount(): void {
  clearListCountCookie('cw_page_count');
}

export function resetContinueWatchingCount(): void {
  resetContinueWatchingPageCount();
  clearListCountCookie('cw_count');
}

export function readFavoriteItemsCount(): number {
  return readListCountCookie('fav_count') ?? 0;
}

export function writeFavoriteItemsCount(value: number): void {
  writeListCountCookie('fav_count', value);
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
  return writeStoredString(
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
): boolean {
  const storageKey = getSourcePreferredQualityStorageKey(sourceKey);
  if (!storageKey) {
    return false;
  }
  return writeStoredString(
    storageKey,
    height && height > 0 ? String(height) : 'auto',
  );
}

export const DANMAKU_OPACITY_RANGE = { min: 0.1, max: 1 };
export const DANMAKU_FONT_SIZE_RANGE = { min: 14, max: 40 };
export const DANMAKU_OFFSET_RANGE = { min: -600, max: 600 };

const DANMAKU_SCOPE_PATTERN = /^[a-zA-Z0-9_.-]{1,96}$/;

export function readDanmakuEnabled(): boolean {
  return readStoredBoolean(DANMAKU_ENABLED_STORAGE_KEY) ?? false;
}

// 仅用于把旧版客户端偏好迁移到账号设置
export function readStoredDanmakuEnabled(): boolean | undefined {
  return readStoredBoolean(DANMAKU_ENABLED_STORAGE_KEY);
}

// 账号设置成功接管后清理旧版客户端偏好
export function clearStoredDanmakuEnabled(): boolean {
  return resetStoredBoolean(DANMAKU_ENABLED_STORAGE_KEY);
}

export function writeDanmakuEnabled(value: boolean): boolean {
  return writeStoredBoolean(DANMAKU_ENABLED_STORAGE_KEY, value);
}

export function readDanmakuHeatmapEnabled(): boolean {
  return readStoredBoolean(DANMAKU_HEATMAP_STORAGE_KEY) ?? true;
}

export function writeDanmakuHeatmapEnabled(value: boolean): boolean {
  return writeStoredBoolean(DANMAKU_HEATMAP_STORAGE_KEY, value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const DANMAKU_DEFAULT_OPACITY = 0.7;
export const DANMAKU_DEFAULT_FONT_SIZE = 24;

export function readDanmakuOpacity(): number {
  const raw = Number.parseFloat(
    readStoredString(DANMAKU_OPACITY_STORAGE_KEY) || '',
  );
  if (!Number.isFinite(raw)) return DANMAKU_DEFAULT_OPACITY;
  return clamp(raw, DANMAKU_OPACITY_RANGE.min, DANMAKU_OPACITY_RANGE.max);
}

export function writeDanmakuOpacity(value: number): boolean {
  const next = Number.isFinite(value)
    ? clamp(value, DANMAKU_OPACITY_RANGE.min, DANMAKU_OPACITY_RANGE.max)
    : DANMAKU_DEFAULT_OPACITY;
  return writeStoredString(DANMAKU_OPACITY_STORAGE_KEY, String(next));
}

export function readDanmakuFontSize(): number {
  const raw = Number.parseInt(
    readStoredString(DANMAKU_FONT_SIZE_STORAGE_KEY) || '',
    10,
  );
  if (!Number.isFinite(raw)) return DANMAKU_DEFAULT_FONT_SIZE;
  return clamp(raw, DANMAKU_FONT_SIZE_RANGE.min, DANMAKU_FONT_SIZE_RANGE.max);
}

export function writeDanmakuFontSize(value: number): boolean {
  const next = Number.isFinite(value)
    ? clamp(
        Math.floor(value),
        DANMAKU_FONT_SIZE_RANGE.min,
        DANMAKU_FONT_SIZE_RANGE.max,
      )
    : DANMAKU_DEFAULT_FONT_SIZE;
  return writeStoredString(DANMAKU_FONT_SIZE_STORAGE_KEY, String(next));
}

// 偏移与弹幕库映射按 源站:视频ID:集索引 维度隔离，换源后各自独立
export function buildDanmakuScopeKey(
  source: string,
  videoId: string,
  episodeIndex: number,
): string | null {
  const normalizedSource = source.trim();
  const normalizedId = videoId.trim();
  if (
    !DANMAKU_SCOPE_PATTERN.test(normalizedSource) ||
    !DANMAKU_SCOPE_PATTERN.test(normalizedId) ||
    !Number.isInteger(episodeIndex) ||
    episodeIndex < 0
  ) {
    return null;
  }
  return `${normalizedSource}:${normalizedId}:${episodeIndex}`;
}

export function readDanmakuOffset(scopeKey: string): number {
  const raw = Number.parseFloat(
    readStoredString(`${DANMAKU_OFFSET_STORAGE_PREFIX}${scopeKey}`) || '',
  );
  if (!Number.isFinite(raw)) return 0;
  return clamp(raw, DANMAKU_OFFSET_RANGE.min, DANMAKU_OFFSET_RANGE.max);
}

export function writeDanmakuOffset(scopeKey: string, value: number): boolean {
  const next = Number.isFinite(value)
    ? clamp(value, DANMAKU_OFFSET_RANGE.min, DANMAKU_OFFSET_RANGE.max)
    : 0;
  return writeStoredString(
    `${DANMAKU_OFFSET_STORAGE_PREFIX}${scopeKey}`,
    String(next),
  );
}

export function readDanmakuEpisodeId(scopeKey: string): number | null {
  const raw = Number.parseInt(
    readStoredString(`${DANMAKU_EPISODE_MAP_STORAGE_PREFIX}${scopeKey}`) || '',
    10,
  );
  return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
}

export function readDanmakuEpisodeSearchTitle(scopeKey: string): string {
  const title =
    readStoredString(
      `${DANMAKU_EPISODE_SEARCH_STORAGE_PREFIX}${scopeKey}`,
    )?.trim() || '';
  return title.length <= 80 ? title : '';
}

export function writeDanmakuEpisodeSearchTitle(
  scopeKey: string,
  title: string,
): boolean {
  const normalized = title.trim();
  if (normalized.length > 80) return false;
  return writeStoredString(
    `${DANMAKU_EPISODE_SEARCH_STORAGE_PREFIX}${scopeKey}`,
    normalized,
  );
}

export function writeDanmakuEpisodeId(
  scopeKey: string,
  episodeId: number | null,
): boolean {
  const key = `${DANMAKU_EPISODE_MAP_STORAGE_PREFIX}${scopeKey}`;
  if (episodeId === null) {
    const cleared = removeStorage(key);
    return writeDanmakuEpisodeSearchTitle(scopeKey, '') && cleared;
  }
  if (!Number.isSafeInteger(episodeId) || episodeId <= 0) return false;
  return writeStoredString(key, String(episodeId));
}
