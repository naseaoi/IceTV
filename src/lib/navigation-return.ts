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
  if (pathname.startsWith('/douban')) {
    return '/categories';
  }
  if (pathname.startsWith('/me/favorites')) {
    return '/me';
  }
  return '/';
}
