// 弹幕管理列表与其骨架共用的行布局
export const USER_DANMAKU_ROW_CLASS = 'flex items-center gap-3 px-4 py-3';
export const USER_DANMAKU_TEXT_CLASS = 'text-sm leading-5';
export const USER_DANMAKU_META_CLASS = 'mt-0.5 text-xs leading-4';
export const USER_DANMAKU_ACTION_CLASS = 'h-8 w-8';
export const USER_DANMAKU_TOOLBAR_CLASS =
  'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between';

export function formatUserDanmakuEpisode(key: string): string {
  if (key.startsWith('dandan:')) return `弹幕集 ${key.slice(7)}`;
  const parts = key.slice(4).split(':');
  const index = Number(parts[parts.length - 1]);
  const source = parts[0] || '未知来源';
  return Number.isInteger(index) ? `${source} · 第 ${index + 1} 集` : source;
}

export function formatUserDanmakuTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
}
