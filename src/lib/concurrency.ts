export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  shouldContinue: () => boolean = () => true,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return [];

  const limit = Math.max(1, Math.min(tasks.length, Math.floor(concurrency)));
  const results: PromiseSettledResult<T>[] = [];
  let index = 0;

  async function worker() {
    while (shouldContinue()) {
      const current = index;
      if (current >= tasks.length) return;
      index += 1;

      try {
        results[current] = {
          status: 'fulfilled',
          value: await tasks[current](),
        };
      } catch (reason) {
        results[current] = {
          status: 'rejected',
          reason,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

// 取消只结束当前消费者的等待，共享加载继续完成并填充缓存。
export async function waitForSharedLoad<T>(
  loader: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return loader();
  if (signal.aborted) throw signal.reason;

  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([loader(), cancelled]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([task, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

export function withAbortableTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([task(controller.signal), timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    parentSignal?.removeEventListener('abort', abortFromParent);
  });
}
