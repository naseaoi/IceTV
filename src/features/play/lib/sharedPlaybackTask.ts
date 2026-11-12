export function playbackAbortError(): DOMException {
  return new DOMException('播放任务已取消', 'AbortError');
}

export function throwIfPlaybackCancelled(signal?: AbortSignal): void {
  if (
    signal?.aborted ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  )
    throw playbackAbortError();
}

export function createSharedPlaybackTask<T>(
  load: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  let consumers = 0;
  let settled = false;
  const promise = load(controller.signal).finally(() => {
    settled = true;
  });
  // 消费者可能全部离开，仍接住底层拒绝。
  void promise.catch(() => undefined);

  return {
    signal: controller.signal,
    consume(signal?: AbortSignal): Promise<T> {
      if (signal?.aborted) return Promise.reject(playbackAbortError());
      consumers += 1;
      return new Promise<T>((resolve, reject) => {
        let released = false;
        const release = () => {
          if (released) return false;
          released = true;
          signal?.removeEventListener('abort', onAbort);
          consumers -= 1;
          // 同一轮换集先清理预热再挂载播放，给正式消费者接管的机会。
          void Promise.resolve().then(() => {
            if (!consumers && !settled) controller.abort();
          });
          return true;
        };
        const onAbort = () => {
          if (release()) reject(playbackAbortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        promise.then(
          (value) => {
            if (release()) resolve(value);
          },
          (error) => {
            if (release()) reject(error);
          },
        );
      });
    },
  };
}
