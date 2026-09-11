export interface AsyncSemaphore {
  acquire(): Promise<() => void>;
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

  async function acquire(): Promise<() => void> {
    if (active < maxConcurrent) {
      active += 1;
      return createReleaseOnce();
    }

    await new Promise<void>((resolve) => {
      waiters.push(() => {
        active += 1;
        resolve();
      });
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
