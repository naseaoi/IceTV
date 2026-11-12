export const LIVE_HIDDEN_STOP_MS = 10 * 60 * 1000;
export const LIVE_IDLE_STOP_MS = 3 * 60 * 60 * 1000;
export const LIVE_INACTIVITY_CHECK_MS = 30 * 1000;

export function shouldStopLiveForInactivity({
  now,
  lastActivityAt,
  hiddenSince,
}: {
  now: number;
  lastActivityAt: number;
  hiddenSince: number | null;
}): boolean {
  if (hiddenSince !== null && now - hiddenSince >= LIVE_HIDDEN_STOP_MS) {
    return true;
  }
  return now - lastActivityAt >= LIVE_IDLE_STOP_MS;
}

// 画中画时页面不可见但用户仍在观看
export function isLivePageEffectivelyHidden(doc: Document): boolean {
  return doc.visibilityState === 'hidden' && !doc.pictureInPictureElement;
}
