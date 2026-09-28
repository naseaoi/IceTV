export type VodForwardBufferLimits = {
  maxBufferLength: number;
  maxMaxBufferLength: number;
};

// 前向缓冲的字节预算（音视频合计），低于 Chromium 视频 SourceBuffer 约 150MB 的配额并留出码率波动与淘汰粒度的余量。
// 回看缓冲不计入：追加超配额时浏览器先淘汰播放位置之前的数据，hls.js 也按 backBufferLength 裁剪；扣除它会让高码率源前向只剩下限
export const VOD_FORWARD_BUFFER_BYTE_BUDGET = 100 * 1000 * 1000;
// 按码率封顶时的前向时长下限，码率再高也保留足够抵御网络抖动的缓冲
export const VOD_MIN_FORWARD_BUFFER_SECONDS = 30;
// 发生 bufferFullError 时把前向上限压到当时前向缓冲的这一比例，播放消耗掉余量后再续载，避免失败分片立即重下又撞配额
export const VOD_BUFFER_FULL_RETAIN_RATIO = 0.8;
// 与 hls.js reduceLengthAndFlushBuffer 一致：当前位置前向不足该值视为未缓冲，hls.js 会整段清空而非降低上限
const BUFFERED_TOLERANCE_SECONDS = 0.5;

// hls.js 的前向目标是 min(max(8*maxBufferSize/码率, maxBufferLength), maxMaxBufferLength)，maxBufferSize 只是下限，
// 真正的时长上限是 maxMaxBufferLength。原目标已在预算内时结果与原配置等效
export function resolveVodForwardBufferLimits(
  base: VodForwardBufferLimits,
  bitrateBps: number | null | undefined,
  learnedBudgetBytes: number | null,
): VodForwardBufferLimits {
  if (!bitrateBps || !Number.isFinite(bitrateBps) || bitrateBps <= 0) {
    return { ...base };
  }
  let capSeconds = Math.max(
    VOD_MIN_FORWARD_BUFFER_SECONDS,
    (VOD_FORWARD_BUFFER_BYTE_BUDGET * 8) / bitrateBps,
  );
  // 实际配额已由 bufferFullError 证明更小，不再受时长下限保护，否则会反复撞配额
  if (learnedBudgetBytes !== null) {
    capSeconds = Math.min(capSeconds, (learnedBudgetBytes * 8) / bitrateBps);
  }
  const maxMaxBufferLength = Math.min(
    base.maxMaxBufferLength,
    Math.max(1, Math.floor(capSeconds)),
  );
  return {
    maxBufferLength: Math.min(base.maxBufferLength, maxMaxBufferLength),
    maxMaxBufferLength,
  };
}

export function resolveVodBufferFullBudgetBytes({
  forwardBufferedSeconds,
  fragmentDurationSeconds,
  bitrateBps,
}: {
  forwardBufferedSeconds: number;
  fragmentDurationSeconds: number;
  bitrateBps: number | null | undefined;
}): number | null {
  if (
    !bitrateBps ||
    !Number.isFinite(bitrateBps) ||
    bitrateBps <= 0 ||
    !(forwardBufferedSeconds > BUFFERED_TOLERANCE_SECONDS)
  ) {
    return null;
  }
  const retainedSeconds = Math.max(
    forwardBufferedSeconds * VOD_BUFFER_FULL_RETAIN_RATIO,
    fragmentDurationSeconds > 0 ? fragmentDurationSeconds : 0,
  );
  return (retainedSeconds * bitrateBps) / 8;
}
