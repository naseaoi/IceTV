export const DEV_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-dev\.(0|[1-9]\d*)$/;

// 返回 null 表示格式无效，由调用方决定兜底策略。
export function compareReleaseVersions(
  left: string,
  right: string,
): number | null {
  const pattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.(0|[1-9]\d*))?$/;
  const a = pattern.exec(left);
  const b = pattern.exec(right);
  if (!a || !b) return null;
  for (let i = 1; i <= 3; i++) {
    const x = BigInt(a[i]);
    const y = BigInt(b[i]);
    if (x !== y) return x > y ? 1 : -1;
  }
  if (a[4] === undefined) return b[4] === undefined ? 0 : 1;
  if (b[4] === undefined) return -1;
  const x = BigInt(a[4]);
  const y = BigInt(b[4]);
  return x === y ? 0 : x > y ? 1 : -1;
}
