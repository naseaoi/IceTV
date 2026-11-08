export class ResourceLimitError extends Error {
  constructor(
    readonly status: 429 | 503 = 503,
    readonly retryAfterSeconds = 1,
  ) {
    super(status === 429 ? '请求过于频繁，请稍后再试' : '服务繁忙，请稍后重试');
    this.name = 'ResourceLimitError';
  }
}

export class UpstreamCooldownError extends ResourceLimitError {
  constructor(retryAfterSeconds: number) {
    super(503, retryAfterSeconds);
    this.name = 'UpstreamCooldownError';
  }
}

export function resourceLimitResponse(error: unknown): Response | null {
  if (!(error instanceof ResourceLimitError)) return null;
  return new Response(JSON.stringify({ error: error.message }), {
    status: error.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Retry-After': String(Math.max(1, Math.ceil(error.retryAfterSeconds))),
    },
  });
}
