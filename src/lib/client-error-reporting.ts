type ErrorWithDigest = Error & { digest?: string };

export interface ClientErrorReport {
  context: string;
  message: string;
  name?: string;
  digest?: string;
  stack?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

interface ClientErrorReportOptions {
  context: string;
  error: unknown;
  metadata?: Record<string, unknown>;
  logger?: Pick<Console, 'error'>;
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || '未知错误';
  }

  if (typeof error === 'string') {
    return error || '未知错误';
  }

  if (error === null) {
    return '未知错误';
  }

  if (typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return '未知错误对象';
    }
  }

  return String(error);
}

function normalizeMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
}

export function buildClientErrorReport(
  context: string,
  error: unknown,
  metadata?: Record<string, unknown>,
): ClientErrorReport {
  const report: ClientErrorReport = {
    context,
    message: normalizeMessage(error),
  };

  if (typeof window !== 'undefined') {
    report.path = window.location.href;
  }

  if (error instanceof Error) {
    report.name = error.name;
    report.stack = error.stack;

    const digest = (error as ErrorWithDigest).digest;
    if (digest) {
      report.digest = digest;
    }
  }

  const normalizedMetadata = normalizeMetadata(metadata);
  if (normalizedMetadata) {
    report.metadata = normalizedMetadata;
  }

  return report;
}

export function reportClientError({
  context,
  error,
  metadata,
  logger = console,
}: ClientErrorReportOptions): ClientErrorReport {
  const report = buildClientErrorReport(context, error, metadata);
  const detailArgs: unknown[] = [
    `[IceTV] ${context}: ${report.message}`,
    report,
  ];

  if (error instanceof Error) {
    detailArgs.push(error);
  }

  logger.error(...detailArgs);

  return report;
}
