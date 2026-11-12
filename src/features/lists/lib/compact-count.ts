export function formatCompactCount(count: number): string {
  if (count < 10000) return String(count);
  const wan = count / 10000;
  return `${wan >= 100 ? Math.round(wan) : Number(wan.toFixed(1))}万`;
}
