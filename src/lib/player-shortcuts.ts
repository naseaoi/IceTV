export const PLAYER_SHORTCUTS_STORAGE_KEY = 'playerShortcuts';
export const PLAYER_SHORTCUTS_CHANGED_EVENT = 'icetv:player-shortcuts-changed';
export const OPEN_PLAYER_SHORTCUTS_EVENT = 'icetv:open-player-shortcuts';

export const SEEK_STEP_SECONDS = 5;
export const SEEK_STEP_LONG_SECONDS = 30;
export const RATE_STEP = 0.1;
export const RATE_MIN = 0.1;
export const RATE_MAX = 4;
export const FRAME_STEP_SECONDS = 1 / 30;
export const VOLUME_STEP = 0.1;

export type PlayerShortcutAction =
  | 'playPause'
  | 'seekBackward'
  | 'seekForward'
  | 'seekBackwardLong'
  | 'seekForwardLong'
  | 'volumeUp'
  | 'volumeDown'
  | 'fullscreen'
  | 'resetRate'
  | 'decreaseRate'
  | 'increaseRate'
  | 'frameBackward'
  | 'frameForward'
  | 'prevEpisode'
  | 'nextEpisode';

export interface ShortcutBinding {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
}

export type PlayerShortcutMap = Record<PlayerShortcutAction, ShortcutBinding>;

export const DEFAULT_PLAYER_SHORTCUTS: PlayerShortcutMap = {
  playPause: { key: ' ' },
  seekBackward: { key: 'ArrowLeft' },
  seekForward: { key: 'ArrowRight' },
  seekBackwardLong: { key: 'ArrowLeft', shiftKey: true },
  seekForwardLong: { key: 'ArrowRight', shiftKey: true },
  volumeUp: { key: 'ArrowUp' },
  volumeDown: { key: 'ArrowDown' },
  fullscreen: { key: 'Enter' },
  resetRate: { key: 'z' },
  decreaseRate: { key: 'x' },
  increaseRate: { key: 'c' },
  frameBackward: { key: 'd' },
  frameForward: { key: 'f' },
  prevEpisode: { key: 'ArrowLeft', altKey: true },
  nextEpisode: { key: 'ArrowRight', altKey: true },
};

export const PLAYER_SHORTCUT_ACTIONS: {
  action: PlayerShortcutAction;
  label: string;
}[] = [
  { action: 'playPause', label: '播放 / 暂停' },
  { action: 'seekBackward', label: '快退 5 秒' },
  { action: 'seekForward', label: '快进 5 秒' },
  { action: 'seekBackwardLong', label: '快退 30 秒' },
  { action: 'seekForwardLong', label: '快进 30 秒' },
  { action: 'volumeUp', label: '音量 +' },
  { action: 'volumeDown', label: '音量 -' },
  { action: 'fullscreen', label: '全屏' },
  { action: 'resetRate', label: '恢复默认倍速' },
  { action: 'decreaseRate', label: '降低倍速 0.1' },
  { action: 'increaseRate', label: '增加倍速 0.1' },
  { action: 'frameBackward', label: '上一帧' },
  { action: 'frameForward', label: '下一帧' },
  { action: 'prevEpisode', label: '上一集' },
  { action: 'nextEpisode', label: '下一集' },
];

function isShortcutBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== 'object') return false;
  const key = (value as { key?: unknown }).key;
  return typeof key === 'string' && key.length > 0;
}

export function readPlayerShortcuts(): PlayerShortcutMap {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_PLAYER_SHORTCUTS };
  }

  const raw = window.localStorage.getItem(PLAYER_SHORTCUTS_STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_PLAYER_SHORTCUTS };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged: PlayerShortcutMap = { ...DEFAULT_PLAYER_SHORTCUTS };
    (Object.keys(DEFAULT_PLAYER_SHORTCUTS) as PlayerShortcutAction[]).forEach(
      (action) => {
        const candidate = parsed[action];
        if (isShortcutBinding(candidate)) {
          merged[action] = {
            key: candidate.key,
            shiftKey: !!candidate.shiftKey,
            altKey: !!candidate.altKey,
            ctrlKey: !!candidate.ctrlKey,
          };
        }
      },
    );
    return merged;
  } catch {
    return { ...DEFAULT_PLAYER_SHORTCUTS };
  }
}

export function writePlayerShortcuts(map: PlayerShortcutMap): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    PLAYER_SHORTCUTS_STORAGE_KEY,
    JSON.stringify(map),
  );
  window.dispatchEvent(new CustomEvent(PLAYER_SHORTCUTS_CHANGED_EVENT));
}

function normalizeKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return ' ';
  return key.length === 1 ? key.toLowerCase() : key;
}

export function matchesBinding(
  event: KeyboardEvent,
  binding: ShortcutBinding,
): boolean {
  if (normalizeKey(event.key) !== normalizeKey(binding.key)) return false;
  if (event.shiftKey !== !!binding.shiftKey) return false;
  if (event.altKey !== !!binding.altKey) return false;
  if (event.ctrlKey !== !!binding.ctrlKey) return false;
  return true;
}

export function resolveShortcutAction(
  event: KeyboardEvent,
  map: PlayerShortcutMap,
): PlayerShortcutAction | null {
  for (const action of Object.keys(map) as PlayerShortcutAction[]) {
    if (matchesBinding(event, map[action])) {
      return action;
    }
  }
  return null;
}

const KEY_DISPLAY_MAP: Record<string, string> = {
  ' ': '空格',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: '回车',
  Escape: 'Esc',
};

export function formatBinding(binding: ShortcutBinding): string {
  const parts: string[] = [];
  if (binding.ctrlKey) parts.push('Ctrl');
  if (binding.altKey) parts.push('Alt');
  if (binding.shiftKey) parts.push('Shift');
  const display =
    KEY_DISPLAY_MAP[binding.key] ??
    (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  parts.push(display);
  return parts.join(' + ');
}

let shortcutsSuspended = false;

export function setPlayerShortcutsSuspended(suspended: boolean): void {
  shortcutsSuspended = suspended;
}

export function arePlayerShortcutsSuspended(): boolean {
  return shortcutsSuspended;
}
