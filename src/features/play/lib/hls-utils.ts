import { formatBytesPerSecond } from '@/lib/player-utils';
import {
  clearSourceProxyOverride,
  rememberSourceServerProxy,
  shouldAutoFallbackToServer,
} from '@/lib/proxy-modes';

type VideoProbeResult = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
};

type MasterVariant = {
  url: string;
  width: number;
  bandwidth: number;
};

type PartialProbeResult = {
  quality: string;
  pingTime: number;
};

type VideoDimensions = {
  width: number;
  height: number;
};

type SegmentProbeResult = {
  loadSpeed: string;
  dimensions: VideoDimensions | null;
};

class ProbeError extends Error {
  partial?: PartialProbeResult;

  constructor(message: string, partial?: PartialProbeResult) {
    super(message);
    this.name = 'ProbeError';
    this.partial = partial;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function mapWidthToQuality(width: number): string {
  if (width >= 3840) return '4K';
  if (width >= 2560) return '2K';
  if (width >= 1920) return '1080p';
  if (width >= 1280) return '720p';
  if (width >= 854) return '480p';
  if (width > 0) return 'SD';
  return '未知';
}

function mapDimensionsToQuality(dimensions: VideoDimensions): string {
  const height = dimensions.height;
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height > 0) return 'SD';
  return '未知';
}

function getNonCommentLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function parseMasterVariants(content: string): MasterVariant[] {
  const lines = content.split('\n');
  const variants: MasterVariant[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const nextLine = lines[i + 1]?.trim() || '';
    if (!nextLine || nextLine.startsWith('#')) continue;

    const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const width = resolutionMatch ? Number.parseInt(resolutionMatch[1], 10) : 0;
    const bandwidthMatch = line.match(/[,:]BANDWIDTH=(\d+)/i);
    const bandwidth = bandwidthMatch
      ? Number.parseInt(bandwidthMatch[1], 10)
      : 0;
    variants.push({
      url: nextLine,
      width,
      bandwidth,
    });
  }

  return variants;
}

function pickProbeVariant(variants: MasterVariant[]) {
  if (!variants.length) return null;

  const bestVariant = [...variants].sort((a, b) => b.width - a.width)[0];

  // 判定 master 声明的 RESOLUTION 是否可信。
  // 源站常见的虚标情形：
  // 1) 混合声明：部分 variant 有 RESOLUTION，部分没有 —— 缺失者可能才是真实高清轨；
  // 2) 统一虚标：所有 variant 的 RESOLUTION 完全相同，但 BANDWIDTH 差距 >2x，
  //    正常情况下带宽翻倍通常伴随分辨率提升，同分辨率带宽剧变多为占位元数据。
  // 命中任一情形时视为不可信，后续 quality 直接标"未知"，避免误导用户。
  const hasMissingResolution = variants.some((v) => v.width <= 0);
  let suspiciousBandwidth = false;
  if (!hasMissingResolution && variants.length >= 2) {
    const allSameWidth = variants.every((v) => v.width === variants[0].width);
    const bandwidths = variants.map((v) => v.bandwidth).filter((bw) => bw > 0);
    if (allSameWidth && bandwidths.length >= 2) {
      const maxBw = Math.max(...bandwidths);
      const minBw = Math.min(...bandwidths);
      if (minBw > 0 && maxBw / minBw > 2) {
        suspiciousBandwidth = true;
      }
    }
  }
  const resolutionTrusted = !hasMissingResolution && !suspiciousBandwidth;

  return {
    bestQualityWidth: bestVariant?.width || 0,
    resolutionTrusted,
    // 测速优先选择首个变体，尽量贴近实际起播路径。
    probePlaylistUrl: variants[0].url,
  };
}

/**
 * 从 master playlist 抽出所有 variant 的 CODECS 声明。
 * 格式：#EXT-X-STREAM-INF:...,CODECS="avc1.64001f,mp4a.40.2",...
 */
function extractMasterCodecs(playlistContent: string): string[] {
  return Array.from(
    playlistContent.matchAll(/#EXT-X-STREAM-INF:[^\n]*CODECS="([^"]+)"/gi),
  ).map((m) => m[1]);
}

/**
 * 基于浏览器 MediaSource.isTypeSupported 判定 master playlist 里的 codec 是否可解码。
 * 命中任何一个可播放的 variant 即算通过；全部不支持才抛错。
 * 说明：
 * - 仅对声明了 CODECS 的 master 生效。media playlist（单档 TS）通常不带 codec，留空放行，
 *   让后续真实起播再暴露问题，避免把大量源误判为不可播放。
 * - 服务端渲染或老浏览器无 MediaSource 时直接跳过，不影响探测流程。
 */
function ensureCodecsPlayable(playlistContent: string): void {
  if (typeof window === 'undefined' || typeof MediaSource === 'undefined') {
    return;
  }

  const codecsList = extractMasterCodecs(playlistContent);
  if (codecsList.length === 0) return;

  const anyPlayable = codecsList.some((codecs) => {
    try {
      return (
        MediaSource.isTypeSupported(`video/mp4; codecs="${codecs}"`) ||
        MediaSource.isTypeSupported(`video/mp2t; codecs="${codecs}"`)
      );
    } catch {
      return false;
    }
  });

  if (!anyPlayable) {
    throw new Error(`Unsupported codec: ${codecsList.join(' | ')}`);
  }
}

function getFirstSegmentUrl(content: string): string | null {
  return getNonCommentLines(content)[0] || null;
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function collectTsPayload(sample: Uint8Array): Uint8Array {
  const packets: Uint8Array[] = [];
  let total = 0;
  for (let offset = 0; offset + 188 <= sample.byteLength; offset += 188) {
    if (sample[offset] !== 0x47) continue;
    const adaptationControl = (sample[offset + 3] >> 4) & 0x03;
    if (adaptationControl === 0 || adaptationControl === 2) continue;

    let payloadOffset = offset + 4;
    if (adaptationControl === 3) {
      payloadOffset += 1 + sample[offset + 4];
    }
    if (payloadOffset >= offset + 188) continue;

    const payload = sample.subarray(payloadOffset, offset + 188);
    packets.push(payload);
    total += payload.byteLength;
  }
  return concatChunks(packets, total);
}

function findAnnexBNalUnits(bytes: Uint8Array): Uint8Array[] {
  const starts: Array<{ pos: number; len: number }> = [];
  for (let i = 0; i < bytes.byteLength - 4; i += 1) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      starts.push({ pos: i, len: 3 });
      i += 2;
      continue;
    }
    if (
      bytes[i] === 0 &&
      bytes[i + 1] === 0 &&
      bytes[i + 2] === 0 &&
      bytes[i + 3] === 1
    ) {
      starts.push({ pos: i, len: 4 });
      i += 3;
    }
  }

  const units: Uint8Array[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i].pos + starts[i].len;
    const end = starts[i + 1]?.pos ?? bytes.byteLength;
    if (end > start) {
      units.push(bytes.subarray(start, end));
    }
  }
  return units;
}

function nalToRbsp(nal: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  for (let i = 1; i < nal.byteLength; i += 1) {
    if (
      i + 2 < nal.byteLength &&
      nal[i] === 0 &&
      nal[i + 1] === 0 &&
      nal[i + 2] === 3
    ) {
      bytes.push(0, 0);
      i += 2;
      continue;
    }
    bytes.push(nal[i]);
  }
  return Uint8Array.from(bytes);
}

class BitReader {
  private bitOffset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readBit(): number {
    const byte = this.bytes[this.bitOffset >> 3] || 0;
    const value = (byte >> (7 - (this.bitOffset & 7))) & 1;
    this.bitOffset += 1;
    return value;
  }

  readBits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value = (value << 1) | this.readBit();
    }
    return value;
  }

  readUE(): number {
    let zeros = 0;
    while (this.bitOffset < this.bytes.byteLength * 8 && this.readBit() === 0) {
      zeros += 1;
    }
    return (1 << zeros) - 1 + this.readBits(zeros);
  }

  readSE(): number {
    const value = this.readUE();
    return value & 1 ? (value + 1) >> 1 : -(value >> 1);
  }
}

function skipScalingList(reader: BitReader, size: number): void {
  let lastScale = 8;
  let nextScale = 8;
  for (let i = 0; i < size; i += 1) {
    if (nextScale !== 0) {
      const deltaScale = reader.readSE();
      nextScale = (lastScale + deltaScale + 256) % 256;
    }
    lastScale = nextScale === 0 ? lastScale : nextScale;
  }
}

function parseSpsDimensions(nal: Uint8Array): VideoDimensions | null {
  try {
    const reader = new BitReader(nalToRbsp(nal));
    const profileIdc = reader.readBits(8);
    reader.readBits(8);
    reader.readBits(8);
    reader.readUE();

    let chromaFormatIdc = 1;
    if (
      [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(
        profileIdc,
      )
    ) {
      chromaFormatIdc = reader.readUE();
      if (chromaFormatIdc === 3) reader.readBit();
      reader.readUE();
      reader.readUE();
      reader.readBit();
      if (reader.readBit()) {
        const count = chromaFormatIdc !== 3 ? 8 : 12;
        for (let i = 0; i < count; i += 1) {
          if (reader.readBit()) {
            skipScalingList(reader, i < 6 ? 16 : 64);
          }
        }
      }
    }

    reader.readUE();
    const picOrderCntType = reader.readUE();
    if (picOrderCntType === 0) {
      reader.readUE();
    } else if (picOrderCntType === 1) {
      reader.readBit();
      reader.readSE();
      reader.readSE();
      const cycleCount = reader.readUE();
      for (let i = 0; i < cycleCount; i += 1) {
        reader.readSE();
      }
    }

    reader.readUE();
    reader.readBit();
    const picWidthInMbsMinus1 = reader.readUE();
    const picHeightInMapUnitsMinus1 = reader.readUE();
    const frameMbsOnlyFlag = reader.readBit();
    if (!frameMbsOnlyFlag) reader.readBit();
    reader.readBit();

    let cropLeft = 0;
    let cropRight = 0;
    let cropTop = 0;
    let cropBottom = 0;
    if (reader.readBit()) {
      cropLeft = reader.readUE();
      cropRight = reader.readUE();
      cropTop = reader.readUE();
      cropBottom = reader.readUE();
    }

    let cropUnitX = 1;
    let cropUnitY = 2 - frameMbsOnlyFlag;
    if (chromaFormatIdc === 1) {
      cropUnitX = 2;
      cropUnitY = 2 * (2 - frameMbsOnlyFlag);
    } else if (chromaFormatIdc === 2) {
      cropUnitX = 2;
      cropUnitY = 2 - frameMbsOnlyFlag;
    }

    return {
      width:
        (picWidthInMbsMinus1 + 1) * 16 - (cropLeft + cropRight) * cropUnitX,
      height:
        (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16 -
        (cropTop + cropBottom) * cropUnitY,
    };
  } catch {
    return null;
  }
}

function detectSegmentDimensions(sample: Uint8Array): VideoDimensions | null {
  const payload = collectTsPayload(sample);
  const units = findAnnexBNalUnits(payload);
  for (const unit of units) {
    if (((unit[0] || 0) & 0x1f) !== 7) continue;
    const dimensions = parseSpsDimensions(unit);
    if (dimensions?.width && dimensions.height) {
      return dimensions;
    }
  }
  return null;
}

/** 带宽测量目标样本量（字节）。达到后提前中断，避免长尾拖慢测速。 */
const BANDWIDTH_SAMPLE_TARGET_BYTES = 512 * 1024;
/** 带宽测量请求的 Range 上限（字节）。1MB 够大，单次 TS 切片通常也不会超过。 */
const BANDWIDTH_SAMPLE_MAX_BYTES = 1024 * 1024;
/** 带宽测量整体超时（毫秒），超过则视为失败。外层还有 15s 兜底。 */
const BANDWIDTH_PROBE_TIMEOUT_MS = 12_000;
/** 低于该样本量的测速视为可信度不足，统一返回"未知"。 */
const BANDWIDTH_MIN_VALID_BYTES = 64 * 1024;

/**
 * 下载首个 segment 样本并基于"首字节到达 → 达标字节"的时间窗计算带宽。
 * 忽略 TCP/TLS 握手阶段，避免把连接建立开销摊到速度里。
 */
async function measureSegmentBandwidth(
  segmentUrl: string,
): Promise<SegmentProbeResult> {
  const controller = new AbortController();
  const timeoutTimer = setTimeout(
    () => controller.abort(),
    BANDWIDTH_PROBE_TIMEOUT_MS,
  );
  try {
    const response = await fetch(segmentUrl, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Range: `bytes=0-${BANDWIDTH_SAMPLE_MAX_BYTES - 1}`,
      },
    });
    if (!response.ok && response.status !== 206) {
      throw new Error('Failed to load first segment');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      // 老浏览器无 ReadableStream，退回到一次性下载（精度会差但能跑）
      const buf = await response.arrayBuffer();
      const sample = new Uint8Array(buf);
      if (buf.byteLength < BANDWIDTH_MIN_VALID_BYTES) {
        return {
          loadSpeed: '未知',
          dimensions: detectSegmentDimensions(sample),
        };
      }
      // 没有首字节时间，只能用响应总耗时粗算，偏保守
      return {
        loadSpeed: formatBytesPerSecond(buf.byteLength / 0.5),
        dimensions: detectSegmentDimensions(sample),
      };
    }

    let bytes = 0;
    let firstByteAt = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (firstByteAt === 0) {
        firstByteAt = performance.now();
      }
      bytes += value.byteLength;
      chunks.push(value);
      if (bytes >= BANDWIDTH_SAMPLE_TARGET_BYTES) {
        // 主动中止：达到目标样本即可，避免长尾拖慢测速
        try {
          await reader.cancel();
        } catch {
          /* 忽略 */
        }
        break;
      }
    }

    const sample = concatChunks(chunks, bytes);
    const dimensions = detectSegmentDimensions(sample);

    if (bytes < BANDWIDTH_MIN_VALID_BYTES || firstByteAt === 0) {
      return { loadSpeed: '未知', dimensions };
    }

    const elapsed = performance.now() - firstByteAt;
    if (elapsed <= 0) return { loadSpeed: '未知', dimensions };

    return {
      loadSpeed: formatBytesPerSecond(bytes / (elapsed / 1000)),
      dimensions,
    };
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new Error('Timeout loading first segment');
    }
    throw err instanceof Error
      ? err
      : new Error(
          (err as { message?: string })?.message || 'Segment probe failed',
        );
  } finally {
    clearTimeout(timeoutTimer);
  }
}

function buildProxyUrl(
  m3u8Url: string,
  useProxy: boolean,
  sourceKey?: string,
): string {
  const params = new URLSearchParams({
    url: m3u8Url,
  });
  if (!useProxy) {
    params.set('allowCORS', 'true');
  } else {
    params.set('forceServer', 'true');
  }
  if (sourceKey) {
    params.set('icetv-source', sourceKey);
  }
  return `/api/proxy/m3u8?${params.toString()}`;
}

function pickBestPartial(
  primary?: PartialProbeResult,
  fallback?: PartialProbeResult,
): PartialProbeResult | undefined {
  if (!primary) return fallback;
  if (!fallback) return primary;
  if (primary.quality !== '未知') return primary;
  if (fallback.quality !== '未知') return fallback;
  return primary.pingTime > 0 ? primary : fallback;
}

function normalizeProbeError(
  error: unknown,
  partial?: PartialProbeResult,
): ProbeError {
  if (error instanceof ProbeError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProbeError(message, partial);
}

async function probeWithMode(
  m3u8Url: string,
  useProxy: boolean,
  sourceKey?: string,
): Promise<VideoProbeResult> {
  const proxyUrl = buildProxyUrl(m3u8Url, useProxy, sourceKey);

  const pingStart = performance.now();
  const pingPromise = fetch(proxyUrl, { method: 'HEAD' })
    .catch(() => null)
    .then(() => Math.round(performance.now() - pingStart));

  let partial: PartialProbeResult | undefined;

  try {
    const playlistResponse = await withTimeout(
      fetch(proxyUrl, { cache: 'no-store' }),
      8000,
      'Timeout loading playlist',
    );
    if (!playlistResponse.ok) {
      throw new ProbeError('Failed to load playlist', partial);
    }

    const playlistContent = await playlistResponse.text();
    ensureCodecsPlayable(playlistContent);
    const variants = parseMasterVariants(playlistContent);
    const pickedVariant = pickProbeVariant(variants);
    const quality =
      pickedVariant && pickedVariant.resolutionTrusted
        ? mapWidthToQuality(pickedVariant.bestQualityWidth)
        : '未知';

    let mediaPlaylistContent = playlistContent;

    if (pickedVariant?.probePlaylistUrl) {
      const mediaPlaylistResponse = await withTimeout(
        fetch(pickedVariant.probePlaylistUrl, { cache: 'no-store' }),
        8000,
        'Timeout loading media playlist',
      );
      if (!mediaPlaylistResponse.ok) {
        throw new ProbeError('Failed to load media playlist');
      }
      mediaPlaylistContent = await mediaPlaylistResponse.text();
    }

    const firstSegmentUrl = getFirstSegmentUrl(mediaPlaylistContent);
    if (!firstSegmentUrl) {
      throw new ProbeError('Missing media segment url');
    }

    // 下载首个分片样本做带宽估算。
    // 策略要点：
    //   1) 样本尽量大：请求 1MB 区间（Range: bytes=0-1048575）。样本过小（<64KB）时
    //      TCP 慢启动 + TLS/代理首包延迟占据耗时主导，算出的 KB/s 会严重偏低。
    //   2) 排除握手开销：从「首字节到达」开始计时，而非 fetch 发起时刻。
    //   3) 滑动达标：累计到 ≥ 512KB 或流结束即停止，避免长尾请求拖长总时长。
    const segmentProbe = await measureSegmentBandwidth(firstSegmentUrl);
    const loadSpeed = segmentProbe.loadSpeed;

    const pingTime = await pingPromise;
    const detectedQuality = segmentProbe.dimensions
      ? mapDimensionsToQuality(segmentProbe.dimensions)
      : quality;
    partial = { quality: detectedQuality, pingTime };

    return {
      quality: detectedQuality,
      loadSpeed,
      pingTime,
    };
  } catch (error) {
    throw normalizeProbeError(error, partial);
  }
}

/**
 * 从 m3u8 地址获取视频质量等级和网络信息。
 * 改为直接请求 playlist 与首个分片，避免为每个源创建隐藏 video+hls 实例。
 *
 * 优化：variant playlist 与 first segment range 尝试并行发起，
 *      将原 3 段串行（HEAD+playlist → variant playlist → first segment）
 *      压缩到 ~2 轮 RTT。若 master 无 variants，退回单 playlist 链路。
 */
export async function getVideoResolutionFromM3u8(
  m3u8Url: string,
  useProxy = true,
  sourceKey = '',
): Promise<VideoProbeResult> {
  try {
    const result = await probeWithMode(m3u8Url, useProxy, sourceKey);
    if (!useProxy && sourceKey) {
      clearSourceProxyOverride(sourceKey, m3u8Url);
    }
    return result;
  } catch (error) {
    const firstError = normalizeProbeError(error);

    if (!useProxy && sourceKey && shouldAutoFallbackToServer(sourceKey)) {
      try {
        const fallbackResult = await probeWithMode(m3u8Url, true, sourceKey);
        if (sourceKey) {
          rememberSourceServerProxy(sourceKey, m3u8Url);
        }
        return fallbackResult;
      } catch (fallbackError) {
        const normalizedFallbackError = normalizeProbeError(fallbackError);
        const partial = pickBestPartial(
          normalizedFallbackError.partial,
          firstError.partial,
        );
        if (partial) {
          return {
            quality: partial.quality,
            loadSpeed: '未知',
            pingTime: partial.pingTime,
          };
        }
        throw new Error(normalizedFallbackError.message);
      }
    }

    if (firstError.partial) {
      return {
        quality: firstError.partial.quality,
        loadSpeed: '未知',
        pingTime: firstError.partial.pingTime,
      };
    }

    throw new Error(
      `Error getting video resolution: ${
        firstError instanceof Error ? firstError.message : String(firstError)
      }`,
    );
  }
}
