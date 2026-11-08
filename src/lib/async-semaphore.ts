import { ResourceLimitError } from '@/lib/server-resource-errors';

export interface AcquireOptions {
  signal?: AbortSignal;
  // 等待者达到上限时直接拒绝，避免过载期间排队任务无界积压
  maxWaiting?: number;
  waitTimeoutMs?: number;
}

export interface AsyncSemaphore {
  acquire(options?: AcquireOptions): Promise<() => void>;
  run<T>(task: () => Promise<T>): Promise<T>;
  setLimit(limit: number): void;
  stats(): { limit: number; active: number; waiting: number };
}

export function createAsyncSemaphore(limit: number): AsyncSemaphore {
  let maxConcurrent = Math.max(1, Math.floor(limit));
  const waiters: Array<() => void> = [];
  let active = 0;

  function wakeWaiters(): void {
    while (active < maxConcurrent && waiters.length > 0) {
      waiters.shift()?.();
    }
  }

  function release(): void {
    active -= 1;
    wakeWaiters();
  }

  async function acquire(options: AcquireOptions = {}): Promise<() => void> {
    const { signal, maxWaiting, waitTimeoutMs } = options;
    if (signal?.aborted) throw abortReason(signal);
    if (active < maxConcurrent) {
      active += 1;
      return createReleaseOnce();
    }
    if (maxWaiting !== undefined && waiters.length >= maxWaiting) {
      throw new ResourceLimitError(503, 1);
    }

    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const waiter = () => {
        settle();
        active += 1;
        resolve();
      };
      const leaveQueue = (error: unknown) => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        settle();
        reject(error);
      };
      const onAbort = () => leaveQueue(abortReason(signal));

      waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (waitTimeoutMs !== undefined && waitTimeoutMs > 0) {
        timer = setTimeout(
          () => leaveQueue(new ResourceLimitError(503, 1)),
          waitTimeoutMs,
        );
      }
    });
    return createReleaseOnce();
  }

  function createReleaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }

  return {
    acquire,
    async run<T>(task: () => Promise<T>): Promise<T> {
      const releaseSlot = await acquire();
      try {
        return await task();
      } finally {
        releaseSlot();
      }
    },
    setLimit(nextLimit: number) {
      const normalized = Math.max(1, Math.floor(nextLimit));
      if (normalized === maxConcurrent) return;
      maxConcurrent = normalized;
      wakeWaiters();
    },
    stats() {
      return { limit: maxConcurrent, active, waiting: waiters.length };
    },
  };
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new Error('Aborted');
}
