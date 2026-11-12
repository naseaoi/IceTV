// 「自动」模式回退成功后，同一标签页短期内优先用该通道，到期后恢复默认顺序重新尝试第三方
const ROUTE_MEMORY_TTL_MS = 5 * 60 * 1000;

export type DoubanRouteKind = 'data' | 'image';

function storageKey(kind: DoubanRouteKind) {
  return `icetv:douban-${kind}-route`;
}

export function readDoubanFallbackRoute(
  kind: DoubanRouteKind,
  now = Date.now(),
): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = JSON.parse(
      window.sessionStorage.getItem(storageKey(kind)) || 'null',
    ) as { route?: unknown; until?: unknown } | null;
    return typeof saved?.route === 'string' &&
      typeof saved.until === 'number' &&
      saved.until > now
      ? saved.route
      : null;
  } catch {
    return null;
  }
}

export function rememberDoubanFallbackRoute(
  kind: DoubanRouteKind,
  route: string | null,
  now = Date.now(),
): void {
  if (typeof window === 'undefined') return;
  try {
    if (route) {
      window.sessionStorage.setItem(
        storageKey(kind),
        JSON.stringify({ route, until: now + ROUTE_MEMORY_TTL_MS }),
      );
    } else {
      window.sessionStorage.removeItem(storageKey(kind));
    }
  } catch {}
}

// 记住的通道排到最前，其余保持默认顺序
export function orderDoubanRoutes<T extends string>(
  routes: readonly T[],
  preferred: string | null,
): T[] {
  const first = routes.find((route) => route === preferred);
  return first
    ? [first, ...routes.filter((route) => route !== first)]
    : [...routes];
}

// 默认顺序之外的通道成功才记住；回到首选通道成功则清除记忆，记住的通道失败也清除
export function recordDoubanRouteResult(
  kind: DoubanRouteKind,
  routes: readonly string[],
  defaultFirst: string,
  attemptIndex: number,
  succeeded: boolean,
): void {
  const route = routes[attemptIndex];
  if (succeeded) {
    if (attemptIndex > 0) {
      rememberDoubanFallbackRoute(kind, route === defaultFirst ? null : route);
    }
  } else if (route === readDoubanFallbackRoute(kind)) {
    rememberDoubanFallbackRoute(kind, null);
  }
}
