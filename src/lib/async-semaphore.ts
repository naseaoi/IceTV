export interface AsyncSemaphore {
  acquire(): Promise<() => void>;
  run<T>(task: () => Promise<T>): Promise<T>;
  stats(): { limit: number; active: number; waiting: number };
}

export function createAsyncSemaphore(limit: number): AsyncSemaphore {
  const maxConcurrent = Math.max(1, Math.floor(limit));
  const waiters: Array<() => void> = [];
  let active = 0;

  function release(): void {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
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
    stats() {
      return { limit: maxConcurrent, active, waiting: waiters.length };
    },
  };
}
