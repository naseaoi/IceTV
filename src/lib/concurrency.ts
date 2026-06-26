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
