import type {
  DanmakuItem,
  DanmakuMode,
} from '@/features/play/lib/danmaku/types';

const DEFAULT_COLOR_DECIMAL = 16777215;
const WHITE = '#FFFFFF';
const MAX_TEXT_LENGTH = 350;
const SPACE_CODE = 32;
const DELETE_CODE = 127;

// dandanplay: 1/2/3 滚动, 4 底部, 5 顶部 → artplayer: 0 滚动, 1 顶部, 2 底部
export function toArtplayerMode(rawMode: unknown): DanmakuMode {
  const mode = typeof rawMode === 'number' ? rawMode : Number(rawMode);
  if (!Number.isFinite(mode)) return 0;
  if (mode === 5) return 1;
  if (mode === 4) return 2;
  return 0;
}

export function toCssColor(rawColor: unknown): string {
  const decimal =
    typeof rawColor === 'number'
      ? rawColor
      : Number.parseInt(String(rawColor), 10);
  if (!Number.isFinite(decimal) || decimal < 0 || decimal > 0xffffff) {
    return WHITE;
  }
  const normalized = Math.floor(decimal) || DEFAULT_COLOR_DECIMAL;
  return `#${normalized.toString(16).padStart(6, '0').toUpperCase()}`;
}

// 控制字符会破坏单行渲染
function stripControlChars(raw: string): string {
  let result = '';
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0;
    result += code < SPACE_CODE || code === DELETE_CODE ? ' ' : char;
  }
  return result;
}

function sanitizeText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = stripControlChars(raw).trim();
  return cleaned.length > MAX_TEXT_LENGTH
    ? cleaned.slice(0, MAX_TEXT_LENGTH)
    : cleaned;
}

function parseTime(raw: unknown): number | null {
  const time = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(time) || time < 0) return null;
  return time;
}

type RawComment = {
  p?: unknown;
  m?: unknown;
  text?: unknown;
  time?: unknown;
  mode?: unknown;
  color?: unknown;
};

// p 字段 4 字段为 时间,类型,颜色,来源
// p 字段 8/9 字段为 时间,类型,字号,颜色,时间戳,弹幕池,用户Hash,弹幕ID[,权重]
function parsePField(
  p: string,
): { time: number; mode: DanmakuMode; color: string } | null {
  const parts = p.split(',');
  if (parts.length < 3) return null;

  const time = parseTime(parts[0]);
  if (time === null) return null;

  const rawColor = parts.length >= 8 ? parts[3] : parts[2];

  return {
    time,
    mode: toArtplayerMode(parts[1]),
    color: toCssColor(rawColor),
  };
}

export function normalizeComment(raw: RawComment): DanmakuItem | null {
  const text = sanitizeText(raw.m ?? raw.text);
  if (!text) return null;

  if (typeof raw.p === 'string' && raw.p) {
    const parsed = parsePField(raw.p);
    if (!parsed) return null;
    return { text, ...parsed };
  }

  const time = parseTime(raw.time);
  if (time === null) return null;

  return {
    text,
    time,
    mode: toArtplayerMode(raw.mode),
    color: toCssColor(raw.color),
  };
}

// 按时间抽稀，保留时间分布而不是截断尾部
export function downsampleByTime(
  items: DanmakuItem[],
  limit: number,
): DanmakuItem[] {
  if (limit <= 0 || items.length <= limit) return items;

  const step = items.length / limit;
  const sampled: DanmakuItem[] = [];
  for (let i = 0; i < limit; i++) {
    sampled.push(items[Math.floor(i * step)]);
  }
  return sampled;
}

export function normalizeComments(
  rawComments: unknown,
  limit: number,
): { items: DanmakuItem[]; total: number; truncated: boolean } {
  if (!Array.isArray(rawComments)) {
    return { items: [], total: 0, truncated: false };
  }

  const items: DanmakuItem[] = [];
  for (const raw of rawComments) {
    if (!raw || typeof raw !== 'object') continue;
    const normalized = normalizeComment(raw as RawComment);
    if (normalized) items.push(normalized);
  }

  items.sort((a, b) => a.time - b.time);
  const total = items.length;
  const sampled = downsampleByTime(items, limit);

  return { items: sampled, total, truncated: sampled.length < total };
}
