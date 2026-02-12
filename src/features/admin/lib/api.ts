type ErrorPayload = {
  error?: string;
};

async function parseJsonSafely<T>(response: Response): Promise<T | null> {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function resolveErrorMessage(
  response: Response,
  fallbackPrefix: string,
): Promise<string> {
  const payload = await parseJsonSafely<ErrorPayload>(response);
  if (payload?.error) {
    return payload.error;
  }
  return `${fallbackPrefix}: ${response.status}`;
}

export async function adminGet<T>(
  endpoint: string,
  fallbackPrefix = '请求失败',
): Promise<T> {
  const response = await fetch(endpoint);

  if (!response.ok) {
    throw new Error(await resolveErrorMessage(response, fallbackPrefix));
  }

  const payload = await parseJsonSafely<T>(response);
  return (payload ?? ({} as T)) as T;
}

export async function adminPost<T = Record<string, unknown>>(
  endpoint: string,
  body?: Record<string, unknown>,
  fallbackPrefix = '操作失败',
): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw new Error(await resolveErrorMessage(response, fallbackPrefix));
  }

  const payload = await parseJsonSafely<T>(response);
  return (payload ?? ({} as T)) as T;
}
