import {
  type VodForwardBufferLimits,
  resolveVodBufferFullBudgetBytes,
  resolveVodForwardBufferLimits,
} from '@/features/play/lib/vodBufferBudgetPolicy';
import {
  type BufferedVideoLike,
  getForwardBufferSeconds,
} from '@/features/play/lib/vodBufferPriority';

type VodBufferBudgetHls = {
  config: VodForwardBufferLimits;
  levels?: ReadonlyArray<{ bitrate?: number } | null | undefined> | null;
};

type VodBufferBudgetFragment =
  | {
      type?: string;
      level?: number;
      duration?: number;
      stats?: { loaded?: number; total?: number };
    }
  | null
  | undefined;

type VodBufferBudgetErrorData =
  | {
      details?: string;
      parent?: string;
      frag?: VodBufferBudgetFragment;
    }
  | null
  | undefined;

export type VodBufferBudgetController = {
  handleFragmentLoading: (frag: VodBufferBudgetFragment) => void;
  handleFragmentLoaded: (frag: VodBufferBudgetFragment) => void;
  // 返回 true 表示已按本次 bufferFullError 收紧前向上限
  handleError: (data: VodBufferBudgetErrorData) => boolean;
};

function getMainFragmentLevel(frag: VodBufferBudgetFragment): number | null {
  if (!frag || frag.type !== 'main') return null;
  return Number.isInteger(frag.level) ? Number(frag.level) : null;
}

// 创建时 hls.config 须已是本次加载的缓冲配置；之后写入的上限不高于该配置，也不高于 hls.js 自行降低过的值
export function createVodBufferBudgetController({
  hls,
  video,
  bufferFullErrorDetail,
}: {
  hls: VodBufferBudgetHls;
  video: BufferedVideoLike;
  bufferFullErrorDetail: string | undefined;
}): VodBufferBudgetController {
  const base: VodForwardBufferLimits = {
    maxBufferLength: hls.config.maxBufferLength,
    maxMaxBufferLength: hls.config.maxMaxBufferLength,
  };
  let lastAppliedMaxMax = base.maxMaxBufferLength;
  const measured = new Map<number, { bytes: number; duration: number }>();
  let loadingLevel: number | null = null;
  let learnedBudgetBytes: number | null = null;

  // 实测优先：清单 BANDWIDTH 常与真实码率不符，起播前没有实测时才用它
  const resolveBitrate = () => {
    if (loadingLevel === null) return null;
    const sample = measured.get(loadingLevel);
    if (sample && sample.duration > 0) {
      return (sample.bytes * 8) / sample.duration;
    }
    const declared = Number(hls.levels?.[loadingLevel]?.bitrate);
    return Number.isFinite(declared) && declared > 0 ? declared : null;
  };

  const apply = () => {
    // hls.js 在 bufferFullError 等场景会自行调低 maxMaxBufferLength，沿用其结果，不再抬回去
    if (hls.config.maxMaxBufferLength < lastAppliedMaxMax) {
      base.maxMaxBufferLength = Math.min(
        base.maxMaxBufferLength,
        hls.config.maxMaxBufferLength,
      );
    }
    const limits = resolveVodForwardBufferLimits(
      base,
      resolveBitrate(),
      learnedBudgetBytes,
    );
    hls.config.maxBufferLength = limits.maxBufferLength;
    hls.config.maxMaxBufferLength = limits.maxMaxBufferLength;
    lastAppliedMaxMax = limits.maxMaxBufferLength;
  };

  return {
    handleFragmentLoading(frag) {
      const level = getMainFragmentLevel(frag);
      if (level === null) return;
      loadingLevel = level;
      apply();
    },
    handleFragmentLoaded(frag) {
      const level = getMainFragmentLevel(frag);
      if (level === null) return;
      const bytes = Number(frag?.stats?.loaded ?? frag?.stats?.total ?? 0);
      const duration = Number(frag?.duration ?? 0);
      if (bytes > 0 && duration > 0) {
        const sample = measured.get(level) ?? { bytes: 0, duration: 0 };
        sample.bytes += bytes;
        sample.duration += duration;
        measured.set(level, sample);
      }
      loadingLevel = level;
      apply();
    },
    handleError(data) {
      if (
        !bufferFullErrorDetail ||
        data?.details !== bufferFullErrorDetail ||
        data.parent !== 'main'
      ) {
        return false;
      }
      const forwardBufferedSeconds = getForwardBufferSeconds(video);
      const bitrateBps = resolveBitrate();
      const budgetBytes = resolveVodBufferFullBudgetBytes({
        forwardBufferedSeconds,
        fragmentDurationSeconds: Number(data.frag?.duration ?? 0),
        bitrateBps,
      });
      if (budgetBytes === null) return false;
      learnedBudgetBytes =
        learnedBudgetBytes === null
          ? budgetBytes
          : Math.min(learnedBudgetBytes, budgetBytes);
      apply();
      console.warn('点播缓冲超出浏览器配额，收紧前向缓冲上限', {
        forwardBufferedSeconds: Number(forwardBufferedSeconds.toFixed(2)),
        bitrateKbps: bitrateBps ? Math.round(bitrateBps / 1000) : null,
        maxMaxBufferLength: hls.config.maxMaxBufferLength,
      });
      return true;
    },
  };
}
