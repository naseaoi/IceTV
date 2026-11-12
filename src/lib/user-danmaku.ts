// 用户弹幕前后端共用的类型与校验；服务端以这里的规则为准，客户端只用于提前拦截
export const USER_DANMAKU_MAX_LENGTH = 100;
export const USER_DANMAKU_KEY_MAX_LENGTH = 256;
// 单集读取上限占 DanmakuEpisodeLimit 的比例，剩余预算留给第三方弹幕
export const USER_DANMAKU_BUDGET_RATIO = 0.5;
export const USER_DANMAKU_DEFAULT_COLOR = '#ffffff';
export const ADMIN_USER_DANMAKU_PAGE_SIZE = 50;
export const ADMIN_USER_DANMAKU_DELETE_LIMIT = 100;

export type UserDanmakuMode = 0 | 1 | 2;

export interface UserDanmakuItem {
  id: string;
  // 弹幕集时间轴上的秒数，未叠加用户校准偏移
  time: number;
  text: string;
  mode: UserDanmakuMode;
  color: string;
  mine: boolean;
}

export interface UserDanmakuListResponse {
  items: UserDanmakuItem[];
  // 当前 DanmakuEpisodeLimit，客户端据此给第三方弹幕分配剩余预算
  limit: number;
}

export interface UserDanmakuSendInput {
  title?: string;
  year?: string;
  key: string;
  time: number;
  text: string;
  mode: UserDanmakuMode;
  color: string;
}

export interface AdminUserDanmakuItem {
  id: string;
  username: string;
  episodeKey: string;
  time: number;
  text: string;
  mode: UserDanmakuMode;
  color: string;
  createdAt: number;
}

export interface AdminUserDanmakuPage {
  items: AdminUserDanmakuItem[];
  nextCursor: string | null;
}

const DANDAN_KEY_PATTERN = /^dandan:[1-9]\d{0,15}$/;
const SOURCE_KEY_PATTERN = /^src:\S+$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
// 控制字符与零宽、双向排版等格式字符
const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu;

// 匹配到第三方弹幕集时挂在该集上，跨播放源共享；否则按播放源内的集隔离
export function buildUserDanmakuKey(
  episodeId: number | null | undefined,
  scopeKey: string,
): string {
  return episodeId && episodeId > 0 ? `dandan:${episodeId}` : `src:${scopeKey}`;
}

export function isValidUserDanmakuKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= USER_DANMAKU_KEY_MAX_LENGTH &&
    (DANDAN_KEY_PATTERN.test(value) || SOURCE_KEY_PATTERN.test(value))
  );
}

export function normalizeUserDanmakuText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  if (!text || [...text].length > USER_DANMAKU_MAX_LENGTH) return null;
  return text;
}

export function normalizeUserDanmakuColor(value: unknown): string {
  if (typeof value !== 'string') return USER_DANMAKU_DEFAULT_COLOR;
  const color = value.trim().toLowerCase();
  return COLOR_PATTERN.test(color) ? color : USER_DANMAKU_DEFAULT_COLOR;
}

export function normalizeUserDanmakuMode(value: unknown): UserDanmakuMode {
  return value === 1 || value === 2 ? value : 0;
}

export function userDanmakuReadLimit(episodeLimit: number): number {
  return Math.max(1, Math.floor(episodeLimit * USER_DANMAKU_BUDGET_RATIO));
}
