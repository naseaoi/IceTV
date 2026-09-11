export const SOURCE_PROBE_HEADER = 'X-IceTV-Probe';
export const SOURCE_PROBE_CONCURRENCY = 2;

export class SourceProbeDeferredError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('服务器繁忙，检测已暂缓');
    this.name = 'SourceProbeDeferredError';
  }
}
