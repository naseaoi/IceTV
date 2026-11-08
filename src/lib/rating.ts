export const RATING_MIN = 1;
export const RATING_MAX = 10;

// 与服务端存储精度一致：一位小数
export function normalizeRating(value: number): number {
  const clamped = Math.min(RATING_MAX, Math.max(RATING_MIN, value));
  return Math.round(clamped * 10) / 10;
}

export function formatRating(value: number): string {
  return value.toFixed(1);
}
