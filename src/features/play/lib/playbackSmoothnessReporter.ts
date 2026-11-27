import {
  type PlaybackSmoothnessEvent,
  type PlaybackSmoothnessSnapshot,
  type PlaybackSmoothnessTotals,
  createPlaybackSmoothnessMeter,
} from '@/features/play/lib/playbackSmoothnessMeter';
import { recordSourcePlaybackSmoothness } from '@/lib/source-playback-stats';
import {
  flushSourceRouteReports,
  reportSourceSmoothness,
} from '@/lib/source-route-stats.client';
import type { SourceRouteMode, SourceSmoothMediaType } from '@/lib/types';

export type PlaybackSmoothnessContext = {
  sessionKey: string;
  key: string;
  source: string;
  routeMode: SourceRouteMode;
  mediaType: SourceSmoothMediaType;
  snapshot: PlaybackSmoothnessSnapshot;
};

const REPORT_INTERVAL_MS = 60_000;

/** 监听生命周期仅用于采样与补报，不控制播放器。 */
export function createPlaybackSmoothnessReporter(
  readContext: () => PlaybackSmoothnessContext | null,
) {
  let session: {
    key: string;
    source: string;
    totals: PlaybackSmoothnessTotals;
  } | null = null;
  let active: {
    context: PlaybackSmoothnessContext;
    meter: ReturnType<typeof createPlaybackSmoothnessMeter>;
    reportedAt: number;
  } | null = null;

  const flush = () => {
    if (!active) return;
    reportSourceSmoothness({
      source: active.context.source,
      routeMode: active.context.routeMode,
      mediaType: active.context.mediaType,
      ...active.meter.takeDelta(),
      eventAt: Date.now(),
    });
    active.reportedAt = Date.now();
  };

  const endSegment = () => {
    if (!active) return;
    const context = readContext();
    if (context?.key === active.context.key) {
      active.meter.update('tick', context.snapshot);
    }
    active.meter.finish();
    flush();
    if (session) {
      const totals = active.meter.getTotals();
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
        session.totals[key] += totals[key];
      }
    }
    active = null;
  };

  const finish = () => {
    endSegment();
    if (session) {
      recordSourcePlaybackSmoothness(session.source, session.totals);
      session = null;
    }
  };

  const handle = (event: PlaybackSmoothnessEvent) => {
    const context = readContext();
    if (session && (!context || context.sessionKey !== session.key)) finish();
    else if (active && context?.key !== active.context.key) endSegment();
    if (!context) return;
    // 复用播放器、线路重载与运行时释放后均等待新的 playing，再确认真实推进。
    if (!active && event === 'playing') {
      session ??= {
        key: context.sessionKey,
        source: context.source,
        totals: { watchMs: 0, stallMs: 0, stallCount: 0, unknownMs: 0 },
      };
      active = {
        context,
        meter: createPlaybackSmoothnessMeter(),
        reportedAt: Date.now(),
      };
    }
    if (!active) return;
    active.context = context;
    active.meter.update(event, context.snapshot);
    if (
      event === 'pause' ||
      Date.now() - active.reportedAt >= REPORT_INTERVAL_MS
    )
      flush();
  };

  const onVisibility = () => {
    handle('tick');
    if (document.visibilityState === 'hidden') {
      flush();
      flushSourceRouteReports();
    }
  };
  const onConnectivity = () => handle('tick');
  const onPageHide = () => {
    handle('tick');
    finish();
    flushSourceRouteReports();
  };
  const timer = setInterval(() => handle('tick'), 1_000);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onConnectivity);
  window.addEventListener('offline', onConnectivity);
  window.addEventListener('pagehide', onPageHide);

  return {
    handle,
    endSegment,
    finish,
    dispose() {
      finish();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onConnectivity);
      window.removeEventListener('offline', onConnectivity);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
}
