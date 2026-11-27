export type PlaybackSmoothnessTotals = {
  watchMs: number;
  stallCount: number;
  stallMs: number;
  unknownMs: number;
};

export type PlaybackSmoothnessSnapshot = {
  currentTime: number;
  forwardBuffer: number;
  paused: boolean;
  visible: boolean;
  online: boolean;
  seeking: boolean;
  resourceWaiting: boolean;
};

export type PlaybackSmoothnessEvent =
  | 'tick'
  | 'playing'
  | 'timeupdate'
  | 'waiting'
  | 'stalled'
  | 'pause'
  | 'seeking'
  | 'seeked';

const MAX_TICK_MS = 5_000;
const CONFIRM_MS = 1_000;
const SEEK_GRACE_MS = 3_000;
const MAX_WAIT_MS = 30_000;
const PROGRESS_SECONDS = 0.05;
const emptyTotals = (): PlaybackSmoothnessTotals => ({
  watchMs: 0,
  stallCount: 0,
  stallMs: 0,
  unknownMs: 0,
});

/** 一个源 × 作品 × 集 × 线路段；只观察媒体，不参与播放恢复。 */
export function createPlaybackSmoothnessMeter(now: () => number = Date.now) {
  const totals = emptyTotals();
  let reported = emptyTotals();
  let lastAt = now();
  let position = 0;
  let playingSeen = false;
  let started = false;
  let running = false;
  let seekUntil = 0;
  let ended = false;
  let lastSnapshot: PlaybackSmoothnessSnapshot | null = null;
  let recoveredAt = -Infinity;
  let mergedStallMs = 0;
  let waiting: {
    at: number;
    position: number;
    kind: 'stallMs' | 'unknownMs' | null;
    accounted: number;
    allowance: number;
  } | null = null;

  const accountWait = (at: number) => {
    if (!waiting?.kind) return;
    const elapsed = Math.max(
      waiting.accounted,
      Math.min(Math.max(0, at - waiting.at), waiting.allowance),
    );
    totals[waiting.kind] += elapsed - waiting.accounted;
    waiting.accounted = elapsed;
  };

  const stopWaiting = (at: number, recovered: boolean) => {
    accountWait(at);
    if (waiting?.kind === 'stallMs' && recovered) {
      recoveredAt = at;
      mergedStallMs += waiting.accounted;
    } else if (!recovered) {
      recoveredAt = -Infinity;
      mergedStallMs = 0;
    }
    waiting = null;
  };

  const update = (
    event: PlaybackSmoothnessEvent,
    sample: PlaybackSmoothnessSnapshot,
  ) => {
    if (ended) return;
    lastSnapshot = sample;
    const at = now();
    const previousAt = lastAt;
    const elapsed = Math.min(MAX_TICK_MS, Math.max(0, at - previousAt));
    lastAt = at;
    const moved = sample.currentTime - position >= PROGRESS_SECONDS;
    if (event === 'playing') playingSeen = true;
    if (event === 'seeking' || event === 'seeked' || sample.seeking) {
      seekUntil = at + SEEK_GRACE_MS;
      // 浏览器可能在目标位置缓冲到位前就触发 seeked；拖动后的加载等同起播，真实推进后才恢复计量
      if (started) {
        started = false;
        playingSeen = true;
      }
    }
    const eligible =
      !sample.paused &&
      sample.visible &&
      sample.online &&
      !sample.seeking &&
      !sample.resourceWaiting &&
      at >= seekUntil;

    if (!eligible) {
      // 排除边界只结算已经确认的等待；资源等待的当前采样区间也不归因给源。
      stopWaiting(sample.resourceWaiting ? previousAt : at, false);
      if (
        running &&
        !sample.resourceWaiting &&
        !sample.seeking &&
        at >= seekUntil
      ) {
        totals.watchMs += elapsed;
      }
      running = false;
      if (sample.paused) playingSeen = false;
      position = sample.currentTime;
      return;
    }

    if (event === 'playing' && !started) position = sample.currentTime;
    if (!started) {
      if (playingSeen && event !== 'playing' && moved) {
        started = true;
        running = true;
      }
      if (!playingSeen) position = sample.currentTime;
      return;
    }

    if (waiting) {
      const resumed = sample.currentTime - waiting.position >= PROGRESS_SECONDS;
      if (resumed) {
        stopWaiting(at, true);
        running = true;
      } else {
        if (!waiting.kind && at - waiting.at >= CONFIRM_MS) {
          waiting.kind = sample.forwardBuffer < 1 ? 'stallMs' : 'unknownMs';
          if (waiting.kind === 'stallMs') {
            const merge = waiting.at - recoveredAt <= CONFIRM_MS;
            if (!merge) {
              totals.stallCount += 1;
              mergedStallMs = 0;
            }
            waiting.allowance = MAX_WAIT_MS - mergedStallMs;
          }
        }
        accountWait(at);
      }
    } else if (running) {
      totals.watchMs += elapsed;
    } else if (moved) {
      running = true;
    }
    position = sample.currentTime;

    if ((event === 'waiting' || event === 'stalled') && !waiting) {
      waiting = {
        at,
        position: sample.currentTime,
        kind: null,
        accounted: 0,
        allowance: Infinity,
      };
      running = false;
    }
  };

  return {
    update,
    finish() {
      if (ended) return;
      if (lastSnapshot) update('tick', lastSnapshot);
      stopWaiting(now(), false);
      ended = true;
    },
    getTotals: (): PlaybackSmoothnessTotals => ({ ...totals }),
    takeDelta(): PlaybackSmoothnessTotals {
      const delta = emptyTotals();
      for (const key of Object.keys(delta) as Array<keyof typeof delta>) {
        delta[key] = totals[key] - reported[key];
      }
      reported = { ...totals };
      return delta;
    },
  };
}
