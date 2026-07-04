export const PLAY_INTENT_KEY = 'icetv_play_intent';
const PLAY_INTENT_TTL_MS = 5 * 60 * 1000;
type PlayIntentResumeMode = 'forced' | null;

interface PlayIntentPayload {
  source: string;
  id: string;
  episodeIndex: number;
  resumeTime: number;
  saveTime: number;
}

interface SavePlayIntentOptions {
  source: string;
  id: string;
  episodeIndex: number;
  resumeTime: number;
}

interface ConsumePlayIntentOptions {
  source: string;
  id: string;
  episodeCount: number;
}

interface PlayIntentRestoreState {
  episodeIndex: number;
  resumeTime: number;
  resumeMode: PlayIntentResumeMode;
}

function isValidPlayIntentPayload(
  payload: Partial<PlayIntentPayload> | null | undefined,
): payload is PlayIntentPayload {
  return (
    !!payload?.source &&
    !!payload.id &&
    Number.isFinite(payload.episodeIndex) &&
    Number.isFinite(payload.resumeTime) &&
    Number.isFinite(payload.saveTime)
  );
}

function clearPlayIntentStorage() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(PLAY_INTENT_KEY);
}

function clampEpisodeIndex(episodeIndex: number, episodeCount: number): number {
  const safeIndex = Math.max(0, Math.floor(episodeIndex));
  if (!Number.isFinite(episodeCount) || episodeCount <= 0) {
    return safeIndex;
  }

  return Math.min(safeIndex, episodeCount - 1);
}

/**
 * 首页“继续观看”点击后写入一次性恢复意图，避免播放页再异步猜测该跳到哪里。
 */
export function savePlayIntent({
  source,
  id,
  episodeIndex,
  resumeTime,
}: SavePlayIntentOptions): void {
  if (typeof window === 'undefined') return;
  if (!source || !id) return;

  const normalizedResumeTime = Math.max(0, Math.floor(resumeTime));
  const payload: PlayIntentPayload = {
    source,
    id,
    episodeIndex: Math.max(0, Math.floor(episodeIndex)),
    resumeTime: normalizedResumeTime,
    saveTime: Date.now(),
  };

  try {
    sessionStorage.setItem(PLAY_INTENT_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('保存播放意图失败:', error);
  }
}

/**
 * 仅消费与当前播放目标匹配的播放意图；命中后立即删除，避免后续页面误复用。
 */
export function consumeMatchingPlayIntent({
  source,
  id,
  episodeCount,
}: ConsumePlayIntentOptions): PlayIntentRestoreState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(PLAY_INTENT_KEY);
    if (!raw) {
      return null;
    }

    const payload = JSON.parse(raw) as Partial<PlayIntentPayload>;
    if (!isValidPlayIntentPayload(payload)) {
      clearPlayIntentStorage();
      return null;
    }

    const payloadEpisodeIndex = Math.floor(payload.episodeIndex);
    const payloadResumeTime = Math.floor(payload.resumeTime);
    const payloadSaveTime = payload.saveTime;

    if (Date.now() - payloadSaveTime > PLAY_INTENT_TTL_MS) {
      clearPlayIntentStorage();
      return null;
    }

    if (payload.source !== source || payload.id !== id) {
      return null;
    }

    const resumeTime = Math.max(0, payloadResumeTime);

    const restoreState: PlayIntentRestoreState = {
      episodeIndex: clampEpisodeIndex(payloadEpisodeIndex, episodeCount),
      resumeTime,
      resumeMode: resumeTime > 0 ? 'forced' : null,
    };

    clearPlayIntentStorage();
    return restoreState;
  } catch (error) {
    console.warn('读取播放意图失败:', error);
    clearPlayIntentStorage();
    return null;
  }
}
