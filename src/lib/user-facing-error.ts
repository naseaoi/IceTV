// 文案已可直接展示：来自 API 响应的 error 字段，或客户端写定的中文提示
export class DisplayableError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(
    message: string,
    options: { status?: number; code?: string } = {},
  ) {
    super(message);
    this.name = 'DisplayableError';
    this.status = options.status;
    this.code = options.code;
  }
}

export const NETWORK_ERROR_MESSAGE = '网络连接失败，请检查网络后重试';
export const SERVICE_UNAVAILABLE_MESSAGE = '服务暂时不可用，请稍后重试';

type RequestErrorShape = { kind?: unknown; status?: unknown };

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

// 切换查询、卸载组件导致的取消不应提示用户
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as RequestErrorShape).kind === 'request_aborted'
  );
}

export function isNetworkError(error: unknown): boolean {
  // fetch 在断网、DNS 失败、CORS 拒绝时统一抛 TypeError
  if (error instanceof TypeError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as RequestErrorShape).kind === 'network'
  );
}

export function getHttpErrorMessage(status: number, fallback: string): string {
  return isTransientStatus(status) ? SERVICE_UNAVAILABLE_MESSAGE : fallback;
}

// 任意异常 → 可展示文案；只信任 DisplayableError 的 message，其余按类别给固定文案
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DisplayableError) return error.message || fallback;
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;
  if (isAbortError(error)) return fallback;
  if (typeof error === 'object' && error !== null) {
    const { kind, status } = error as RequestErrorShape;
    if (kind === 'http' && typeof status === 'number') {
      return getHttpErrorMessage(status, fallback);
    }
  }
  return fallback;
}
