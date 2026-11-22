const INTERNAL_ORIGIN = 'https://icetv.local';
const MAX_INTERNAL_PATH_LENGTH = 2048;

export const RETURN_TO_PARAM = 'returnTo';
export const PLAYER_EXIT_EVENT = 'icetv:player-exit';

function parseInternalPath(value: string): URL | null {
  if (!value.startsWith('/') || value.length > MAX_INTERNAL_PATH_LENGTH) {
    return null;
  }

  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    return parsed.origin === INTERNAL_ORIGIN ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeInternalReturnPath(
  value: string | null | undefined,
  fallback = '/',
): string {
  const fallbackUrl =
    parseInternalPath(fallback) ?? new URL('/', INTERNAL_ORIGIN);
  if (!value) {
    return `${fallbackUrl.pathname}${fallbackUrl.search}${fallbackUrl.hash}`;
  }

  const parsed = parseInternalPath(value);
  if (!parsed || parsed.pathname.startsWith('/play')) {
    return `${fallbackUrl.pathname}${fallbackUrl.search}${fallbackUrl.hash}`;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

const PLAY_RETURN_TO_KEY = 'icetv:play-return-to';
const MAX_PLAY_RETURN_TO_ENTRIES = 20;

type PlayReturnToMap = Record<string, string>;

function readPlayReturnToMap(): PlayReturnToMap {
  try {
    const saved: unknown = JSON.parse(
      window.sessionStorage.getItem(PLAY_RETURN_TO_KEY) || 'null',
    );
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function writePlayReturnToMap(map: PlayReturnToMap): void {
  try {
    window.sessionStorage.setItem(PLAY_RETURN_TO_KEY, JSON.stringify(map));
  } catch {}
}

// 播放页地址精简后不再携带 returnTo，按播放页地址存在本标签页（保留最近若干条），
// 刷新或前进后退回到该页时返回按钮仍回到来源
export function rememberPlayReturnTo(playPage: string, returnTo: string): void {
  const map = readPlayReturnToMap();
  delete map[playPage];
  map[playPage] = normalizeInternalReturnPath(returnTo);
  const keys = Object.keys(map);
  const overflow = keys.length - MAX_PLAY_RETURN_TO_ENTRIES;
  for (const key of keys.slice(0, Math.max(overflow, 0))) {
    delete map[key];
  }
  writePlayReturnToMap(map);
}

export function forgetPlayReturnTo(playPage: string): void {
  const map = readPlayReturnToMap();
  if (!(playPage in map)) return;
  delete map[playPage];
  writePlayReturnToMap(map);
}

export function readPlayReturnTo(playPage: string): string | null {
  return readPlayReturnToMap()[playPage] ?? null;
}

export function getCurrentNavigationPath(): string {
  if (typeof window === 'undefined') {
    return '/';
  }

  return normalizeInternalReturnPath(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

export function withReturnTo(target: string, returnTo: string): string {
  const parsedTarget = parseInternalPath(target);
  if (!parsedTarget) {
    return target;
  }

  parsedTarget.searchParams.set(
    RETURN_TO_PARAM,
    normalizeInternalReturnPath(returnTo),
  );
  return `${parsedTarget.pathname}${parsedTarget.search}${parsedTarget.hash}`;
}

export function getBackFallbackPath(pathname: string): string {
  if (pathname.startsWith('/lists/')) return '/me/lists';
  if (
    pathname.startsWith('/me/') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/u/')
  ) {
    return '/me';
  }
  return '/';
}
