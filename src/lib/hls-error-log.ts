type HlsErrorLogScope = 'vod' | 'live';
type HlsErrorLogLevel = 'error' | 'debug';

export interface HlsErrorLogContext {
  scope: HlsErrorLogScope;
  sourceKey?: string;
  phase?: string;
  expectedAbort?: boolean;
  now?: number;
  windowMs?: number;
  logger?: Pick<Console, 'error' | 'debug'>;
}

export interface HlsErrorLogResult {
  level: HlsErrorLogLevel;
  logged: boolean;
  abortLike: boolean;
  expectedAbort: boolean;
  stage: string;
  suppressedCount: number;
}

type HlsErrorLogBucket = {
  lastLoggedAt: number;
  suppressedCount: number;
};

const DEFAULT_HLS_ERROR_LOG_WINDOW_MS = 10_000;
const hlsErrorLogBuckets = new Map<string, HlsErrorLogBucket>();

export function logHlsError(
  event: unknown,
  data: any,
  context: HlsErrorLogContext,
): HlsErrorLogResult {
  const now = context.now ?? Date.now();
  const windowMs = context.windowMs ?? DEFAULT_HLS_ERROR_LOG_WINDOW_MS;
  const logger = context.logger ?? console;
  const stage = normalizeHlsErrorStage(data);
  const abortLike = isAbortLikeHlsError(data);
  const expectedAbort = abortLike && context.expectedAbort === true;
  const fatal = data?.fatal === true;
  const level: HlsErrorLogLevel = expectedAbort || !fatal ? 'debug' : 'error';
  const key = [
    context.scope,
    context.sourceKey || 'unknown',
    context.phase || 'default',
    stage,
    fatal ? 'fatal' : 'recoverable',
    level,
  ].join('|');
  const bucket = hlsErrorLogBuckets.get(key);

  if (bucket && now - bucket.lastLoggedAt < windowMs) {
    bucket.suppressedCount += 1;
    return {
      level,
      logged: false,
      abortLike,
      expectedAbort,
      stage,
      suppressedCount: bucket.suppressedCount,
    };
  }

  const suppressedCount = bucket?.suppressedCount || 0;
  hlsErrorLogBuckets.set(key, {
    lastLoggedAt: now,
    suppressedCount: 0,
  });

  const meta = {
    scope: context.scope,
    sourceKey: context.sourceKey || null,
    phase: context.phase || null,
    stage,
    fatal,
    abortLike,
    expectedAbort,
    status: getHlsErrorStatus(data) || null,
    suppressedCount,
  };
  const repeatText = suppressedCount > 0 ? `, merged ${suppressedCount}` : '';

  if (level === 'debug') {
    logger.debug(
      expectedAbort
        ? `HLS expected abort${repeatText}:`
        : `HLS recoverable error${repeatText}:`,
      event,
      data,
      meta,
    );
  } else {
    logger.error(`HLS Error${repeatText}:`, event, data, meta);
  }

  return {
    level,
    logged: true,
    abortLike,
    expectedAbort,
    stage,
    suppressedCount,
  };
}

export function resetHlsErrorLogState(): void {
  hlsErrorLogBuckets.clear();
}

export function isAbortLikeHlsError(data: any): boolean {
  const text = getHlsErrorText(data).toLowerCase();
  if (text.includes('net::err_aborted')) return true;
  if (text.includes('aborterror')) return true;
  if (text.includes('aborted')) return true;
  if (data?.error?.name === 'AbortError') return true;
  return false;
}

function normalizeHlsErrorStage(data: any): string {
  const details = String(data?.details || '').trim();
  if (details) return details;
  const type = String(data?.type || '').trim();
  if (type) return type;
  return 'unknown';
}

function getHlsErrorText(data: any): string {
  return [
    data?.type,
    data?.details,
    data?.error?.name,
    data?.error?.message,
    data?.response?.text,
    data?.networkDetails?.statusText,
  ]
    .filter(Boolean)
    .join(' ');
}

function getHlsErrorStatus(data: any): number | undefined {
  const candidates = [
    data?.response?.code,
    data?.response?.status,
    data?.networkDetails?.status,
  ];
  for (const item of candidates) {
    const status = Number(item);
    if (Number.isFinite(status) && status > 0) {
      return status;
    }
  }
  return undefined;
}
