import { createTimedAbortController } from '@/lib/downstream-sources/shared';

type DoubanFetchInit = RequestInit & {
  next?: {
    revalidate?: number;
  };
};

export async function fetchDoubanData<T>(
  url: string,
  init: DoubanFetchInit = {},
): Promise<T> {
  const abortState = createTimedAbortController(
    init.signal ?? undefined,
    10000,
  );
  const headers = new Headers(init.headers);

  if (!headers.has('User-Agent')) {
    headers.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    );
  }
  if (!headers.has('Referer')) {
    headers.set('Referer', 'https://movie.douban.com/');
  }
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json, text/plain, */*');
  }
  if (!headers.has('Origin')) {
    headers.set('Origin', 'https://movie.douban.com');
  }

  const fetchOptions = {
    ...init,
    signal: abortState.signal,
    headers,
  };

  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    throw error;
  } finally {
    abortState.cleanup();
  }
}
