export const SOURCE_PROBE_HEADER = 'X-IceTV-Probe';
export const SOURCE_PROBE_CONCURRENCY = 2;

export class SourceProbeDeferredError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('服务器繁忙，检测已暂缓');
    this.name = 'SourceProbeDeferredError';
  }
}

export class SourceProbeNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceProbeNetworkError';
  }
}

export function isSourceProbeNetworkError(error: unknown): boolean {
  return (
    (typeof navigator === 'undefined' || navigator.onLine !== false) &&
    error instanceof SourceProbeNetworkError
  );
}

// fetch 收到响应头后，正文流断开仍属于网络加载失败；只包裹正文读取，避免把解析 TypeError 误判成线路问题。
export async function readSourceProbeBody<T>(
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TypeError)
      throw new SourceProbeNetworkError(error.message);
    throw error;
  }
}
