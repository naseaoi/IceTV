export const LIVE_HEALTH_POLICY = {
  slowMs: 1500,
  requestTimeoutMs: 8000,
  playlistMaxBytes: 64 * 1024,
  segmentSampleBytes: 64 * 1024,
  endedProgramAgeMs: 24 * 60 * 60 * 1000,
  hostConnectionFailureLimit: 2,
  // 按请求正文上限预扣，实际传输远小于此；需覆盖一轮全部到期线路（约 160 KiB / 条）
  roundMaxBytes: 96 * 1024 * 1024,
  // 每小时一轮须在 3 小时重测周期内覆盖全部线路，实测约 2 条 / 秒（并发 2）
  roundMaxMs: 240_000,
  concurrency: 3,
  maxRedirects: 5,
  refreshMs: 3 * 60 * 60 * 1000,
  unknownAfterMs: 12 * 60 * 60 * 1000,
  snapshotReadWaitMs: 500,
  snapshotRetentionMs: 7 * 24 * 60 * 60 * 1000,
  leaseMs: 90_000,
  snapshotMaxBytes: 2 * 1024 * 1024,
} as const;

export const LIVE_HEALTH_IDENTITY = 'system:live-health';
