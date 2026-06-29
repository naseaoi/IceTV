import type { ApiSite } from '@/lib/config';

export const BROWSER_HTML_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

export function createTimedAbortController(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timeoutFired = false;

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timeoutFired = true;
    controller.abort(new Error('timeout'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    isTimeout: () => timeoutFired,
    cleanup: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'AbortError' ||
    (error as Error & { code?: number }).code === 20 ||
    error.message.includes('aborted')
  );
}

export function getSiteOrigin(apiSite: ApiSite): string {
  const fallback = apiSite.api.replace(/\/+$/, '');
  try {
    return new URL(apiSite.api).origin;
  } catch {
    return fallback;
  }
}

export function toAbsoluteUrl(url: string, origin: string): string {
  if (!url) return '';
  try {
    return new URL(url, origin).toString();
  } catch {
    return url;
  }
}

export function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, '').toLowerCase();
}

export function uniqueOrigins(
  origins: string[],
  disabledOrigins: ReadonlySet<string> = new Set(),
): string[] {
  const seen = new Set<string>();
  return origins
    .map((origin) => origin.replace(/\/+$/, ''))
    .filter((origin) => {
      const normalized = normalizeOrigin(origin);
      if (
        !normalized ||
        seen.has(normalized) ||
        disabledOrigins.has(normalized)
      ) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

export function prioritizeOrigins(
  origins: string[],
  preferredOrigin: string,
  disabledOrigins: ReadonlySet<string> = new Set(),
): string[] {
  return uniqueOrigins(
    [
      preferredOrigin,
      ...origins.filter((origin) => origin !== preferredOrigin),
    ],
    disabledOrigins,
  );
}

export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  shouldContinue: () => boolean = () => true,
): Promise<T[]> {
  if (tasks.length === 0) return [];

  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (shouldContinue() && index < tasks.length) {
      const current = index;
      index += 1;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);

  return results;
}
