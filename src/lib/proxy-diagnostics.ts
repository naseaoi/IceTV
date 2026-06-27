export type ProxyRouteName = 'm3u8' | 'segment';

export type ProxyFailureStage =
  | 'request'
  | 'validation'
  | 'auth'
  | 'proxy'
  | 'upstream'
  | 'response'
  | 'rewrite'
  | 'internal';

export type ProxyFailureReason =
  | 'missing-url'
  | 'invalid-url'
  | 'auth-failed'
  | 'upstream-http'
  | 'upstream-fetch'
  | 'upstream-timeout'
  | 'upstream-abort'
  | 'content-type'
  | 'response-too-large'
  | 'proxy-http'
  | 'proxy-connect'
  | 'proxy-timeout'
  | 'proxy-response'
  | 'proxy-response-too-large'
  | 'internal';

export interface ProxyFailureDiagnostic {
  route: ProxyRouteName;
  stage: ProxyFailureStage;
  reason: ProxyFailureReason;
  status: number;
  code: string;
  message: string;
  source?: string | null;
  targetUrl?: string;
  proxyUrl?: URL | string | null;
  proxyMode?: string;
  upstreamStatus?: number;
  upstreamErrorType?: string;
  elapsedMs?: number;
  isLive?: boolean;
  range?: string | null;
  userAction?: string | null;
  userInitiated?: boolean;
  error?: unknown;
}

export interface ProxyFailureInput {
  route: ProxyRouteName;
  stage: ProxyFailureStage;
  reason: ProxyFailureReason;
  status?: number;
  code?: string;
  message?: string;
  source?: string | null;
  targetUrl?: string;
  proxyUrl?: URL | string | null;
  proxyMode?: string;
  upstreamStatus?: number;
  upstreamErrorType?: string;
  elapsedMs?: number;
  isLive?: boolean;
  range?: string | null;
  userAction?: string | null;
  userInitiated?: boolean;
  error?: unknown;
}

export class ProxyRouteError extends Error {
  readonly diagnostic: ProxyFailureDiagnostic;

  constructor(input: ProxyFailureInput) {
    const reason = input.reason;
    const status =
      input.status ??
      resolveProxyFailureHttpStatus(reason, input.upstreamStatus);
    const message = input.message || getDefaultProxyFailureMessage(reason);
    super(message);
    this.name = 'ProxyRouteError';
    this.diagnostic = {
      ...input,
      status,
      code: input.code || toProxyFailureCode(reason),
      message,
      upstreamErrorType:
        input.upstreamErrorType || getUpstreamErrorType(input.error),
    };
  }
}

export function createProxyFailureDiagnostic(
  input: ProxyFailureInput,
): ProxyFailureDiagnostic {
  const status =
    input.status ??
    resolveProxyFailureHttpStatus(input.reason, input.upstreamStatus);
  return {
    ...input,
    status,
    code: input.code || toProxyFailureCode(input.reason),
    message: input.message || getDefaultProxyFailureMessage(input.reason),
    upstreamErrorType:
      input.upstreamErrorType || getUpstreamErrorType(input.error),
  };
}

export function classifyProxyFailure(
  error: unknown,
  defaults: ProxyFailureInput,
): ProxyFailureDiagnostic {
  if (error instanceof ProxyRouteError) {
    return createProxyFailureDiagnostic({
      ...defaults,
      ...error.diagnostic,
      elapsedMs: error.diagnostic.elapsedMs ?? defaults.elapsedMs,
      error: error.diagnostic.error || error,
    });
  }

  const message = getErrorMessage(error);
  const name = getErrorName(error);
  const status = extractStatusFromMessage(message);

  if (name === 'UrlValidationError') {
    return createProxyFailureDiagnostic({
      ...defaults,
      stage: 'validation',
      reason: 'invalid-url',
      status: 403,
      message,
      error,
    });
  }

  if (name === 'ResponseSizeLimitError' || message.includes('too large')) {
    return createProxyFailureDiagnostic({
      ...defaults,
      stage: 'response',
      reason:
        defaults.stage === 'proxy'
          ? 'proxy-response-too-large'
          : 'response-too-large',
      status: 413,
      message,
      error,
    });
  }

  if (name === 'AbortError') {
    return createProxyFailureDiagnostic({
      ...defaults,
      stage: defaults.stage === 'proxy' ? 'proxy' : 'upstream',
      reason: defaults.stage === 'proxy' ? 'proxy-timeout' : 'upstream-abort',
      status: 504,
      message,
      error,
    });
  }

  if (isTimeoutMessage(message)) {
    return createProxyFailureDiagnostic({
      ...defaults,
      stage: defaults.stage === 'proxy' ? 'proxy' : 'upstream',
      reason: defaults.stage === 'proxy' ? 'proxy-timeout' : 'upstream-timeout',
      status: 504,
      message,
      error,
    });
  }

  if (message.includes('代理连接失败')) {
    return createProxyFailureDiagnostic({
      ...defaults,
      stage: 'proxy',
      reason: 'proxy-connect',
      upstreamStatus: status,
      status: status && status >= 500 ? status : 502,
      message,
      error,
    });
  }

  if (message.includes('代理请求失败')) {
    return createProxyFailureDiagnostic({
      ...defaults,
      stage: 'proxy',
      reason: 'proxy-http',
      upstreamStatus: status,
      status: status && status >= 500 ? status : 502,
      message,
      error,
    });
  }

  if (message.includes('响应头异常') || message.includes('解析失败')) {
    return createProxyFailureDiagnostic({
      ...defaults,
      stage: 'proxy',
      reason: 'proxy-response',
      status: 502,
      message,
      error,
    });
  }

  return createProxyFailureDiagnostic({
    ...defaults,
    reason: defaults.reason || 'upstream-fetch',
    message,
    error,
  });
}

export function toProxyFailurePayload(diagnostic: ProxyFailureDiagnostic) {
  return {
    error: diagnostic.message,
    code: diagnostic.code,
    reason: diagnostic.reason,
    stage: diagnostic.stage,
    source: diagnostic.source || undefined,
    status: diagnostic.upstreamStatus,
  };
}

export function logProxyFailure(diagnostic: ProxyFailureDiagnostic): void {
  const logData = {
    route: diagnostic.route,
    source: diagnostic.source || null,
    stage: diagnostic.stage,
    reason: diagnostic.reason,
    httpStatus: diagnostic.status,
    upstreamStatus: diagnostic.upstreamStatus || null,
    upstreamErrorType:
      diagnostic.upstreamErrorType || getUpstreamErrorType(diagnostic.error),
    elapsedMs: diagnostic.elapsedMs ?? null,
    proxyMode: diagnostic.proxyMode || null,
    isLive: diagnostic.isLive === true,
    userAction: diagnostic.userAction || null,
    userInitiated: diagnostic.userInitiated === true,
    range: diagnostic.range ? 'present' : null,
    target: sanitizeProxyLogUrl(diagnostic.targetUrl),
    proxy: sanitizeProxyLogUrl(diagnostic.proxyUrl?.toString()),
    error: summarizeError(diagnostic.error),
  };

  console.warn('[proxy.failure]', logData);
}

export function sanitizeProxyLogUrl(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    const params = new URLSearchParams();
    for (const [key] of url.searchParams) {
      params.append(key, '<redacted>');
    }
    const query = params.toString();
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return '<invalid-url>';
  }
}

function resolveProxyFailureHttpStatus(
  reason: ProxyFailureReason,
  upstreamStatus?: number,
): number {
  if (reason === 'missing-url') return 400;
  if (reason === 'invalid-url' || reason === 'auth-failed') return 403;
  if (
    reason === 'response-too-large' ||
    reason === 'proxy-response-too-large'
  ) {
    return 413;
  }
  if (reason === 'upstream-timeout' || reason === 'proxy-timeout') return 504;
  if (
    reason === 'upstream-http' &&
    upstreamStatus &&
    upstreamStatus >= 400 &&
    upstreamStatus <= 599
  ) {
    return upstreamStatus;
  }
  if (reason === 'content-type') return 502;
  if (reason.startsWith('proxy-')) return 502;
  if (reason.startsWith('upstream-')) return 502;
  return 500;
}

function toProxyFailureCode(reason: ProxyFailureReason): string {
  return reason.replace(/-/g, '_').toUpperCase();
}

function getDefaultProxyFailureMessage(reason: ProxyFailureReason): string {
  switch (reason) {
    case 'missing-url':
      return 'Missing url';
    case 'invalid-url':
      return 'Invalid proxy url';
    case 'auth-failed':
      return 'Proxy authorization failed';
    case 'upstream-http':
      return 'Upstream returned an error status';
    case 'upstream-timeout':
      return 'Upstream request timed out';
    case 'upstream-abort':
      return 'Upstream request aborted';
    case 'content-type':
      return 'Unexpected upstream content type';
    case 'response-too-large':
    case 'proxy-response-too-large':
      return 'Response body too large';
    case 'proxy-http':
      return 'HTTP proxy returned an error status';
    case 'proxy-connect':
      return 'HTTP proxy connect failed';
    case 'proxy-timeout':
      return 'HTTP proxy request timed out';
    case 'proxy-response':
      return 'HTTP proxy response is invalid';
    case 'internal':
      return 'Proxy internal error';
    default:
      return 'Upstream request failed';
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Proxy request failed';
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

function getUpstreamErrorType(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  const cause = record.cause as Record<string, unknown> | undefined;
  const code =
    typeof record.code === 'string'
      ? record.code
      : typeof cause?.code === 'string'
        ? cause.code
        : undefined;
  const name = error instanceof Error ? error.name : undefined;
  if (name && code) return `${name}:${code}`;
  return code || name;
}

function summarizeError(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      type: getUpstreamErrorType(error) || null,
    };
  }
  return { message: String(error) };
}

function extractStatusFromMessage(message: string): number | undefined {
  const match = message.match(/(\d{3})/);
  if (!match) return undefined;
  const status = Number.parseInt(match[1], 10);
  return Number.isFinite(status) ? status : undefined;
}

function isTimeoutMessage(message: string): boolean {
  return /timeout|timed out|超时/i.test(message);
}
