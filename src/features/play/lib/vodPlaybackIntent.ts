import { reportSourcePlayOutcome } from '@/lib/source-route-stats.client';

export type VodSourceAttempt = {
  source: string;
  id: string;
  triedRoutes: Set<'browser' | 'server'>;
  routeSwitched: boolean;
  allowAutoFallback: boolean;
  startedAt: number | null;
};

export type VodPlaybackIntent = {
  sources: Map<string, VodSourceAttempt>;
  activeSource: VodSourceAttempt | null;
  attempts: number;
  reportedSources: Set<string>;
};

export function createVodPlaybackIntent(): VodPlaybackIntent {
  return {
    sources: new Map(),
    activeSource: null,
    attempts: 0,
    reportedSources: new Set(),
  };
}

export function getVodSourceAttempt(
  intent: VodPlaybackIntent,
  source: string,
  id: string,
): VodSourceAttempt {
  const key = JSON.stringify([source, id]);
  let attempt = intent.sources.get(key);
  if (!attempt) {
    attempt = {
      source,
      id,
      triedRoutes: new Set(),
      routeSwitched: false,
      allowAutoFallback: false,
      startedAt: null,
    };
    intent.sources.set(key, attempt);
  }
  intent.activeSource = attempt;
  return attempt;
}

export function canHandleVodPlaybackFailure(
  intent: VodPlaybackIntent,
  currentIntent: VodPlaybackIntent,
): boolean {
  return (
    intent === currentIntent &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)
  );
}

export function reportVodPlaybackOutcome(
  intent: VodPlaybackIntent,
  source: string,
  success: boolean,
): void {
  if (
    !source ||
    intent.reportedSources.has(source) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  )
    return;
  intent.reportedSources.add(source);
  reportSourcePlayOutcome(source, success);
}

export function isVodRouteNetworkError(data: {
  type?: string;
  details?: string;
}): boolean {
  return (
    (typeof navigator === 'undefined' || navigator.onLine !== false) &&
    data.type === 'networkError' &&
    /^(manifest|level|audioTrack|subtitleTrack|key|frag|segment)Load(Error|TimeOut)$/i.test(
      data.details || '',
    )
  );
}
