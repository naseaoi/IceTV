import { createAsyncSemaphore } from '@/lib/async-semaphore';
import { ResourceLimitError } from '@/lib/server-resource-errors';

describe('async semaphore', () => {
  it('并发不超过上限，超出的任务排队', async () => {
    const gate = createAsyncSemaphore(2);
    let active = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];

    const tasks = Array.from({ length: 5 }, () =>
      gate.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        active -= 1;
      }),
    );

    await Promise.resolve();
    expect(gate.stats().active).toBe(2);
    expect(gate.stats().waiting).toBe(3);

    while (resolvers.length > 0) {
      resolvers.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    }

    await Promise.all(tasks);
    expect(peak).toBe(2);
    expect(gate.stats().active).toBe(0);
    expect(gate.stats().waiting).toBe(0);
  });

  it('任务抛错也会释放槽位', async () => {
    const gate = createAsyncSemaphore(1);

    await expect(
      gate.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(gate.stats().active).toBe(0);
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('重复调用释放函数只生效一次', async () => {
    const gate = createAsyncSemaphore(1);
    const release = await gate.acquire();

    expect(gate.stats().active).toBe(1);
    release();
    release();
    expect(gate.stats().active).toBe(0);
  });

  it('上限至少为 1', async () => {
    expect(createAsyncSemaphore(0).stats().limit).toBe(1);
    expect(createAsyncSemaphore(-5).stats().limit).toBe(1);
  });

  it('扩容立即放行排队任务', async () => {
    const gate = createAsyncSemaphore(1);
    const first = await gate.acquire();
    let secondReady = false;
    let thirdReady = false;

    void gate.acquire().then(() => {
      secondReady = true;
    });
    void gate.acquire().then(() => {
      thirdReady = true;
    });
    await Promise.resolve();
    expect(gate.stats()).toEqual({ limit: 1, active: 1, waiting: 2 });

    gate.setLimit(3);
    await Promise.resolve();
    await Promise.resolve();

    expect(secondReady).toBe(true);
    expect(thirdReady).toBe(true);
    expect(gate.stats()).toEqual({ limit: 3, active: 3, waiting: 0 });
    first();
  });

  it('缩容后不超发槽位', async () => {
    const gate = createAsyncSemaphore(4);
    const releases = await Promise.all([
      gate.acquire(),
      gate.acquire(),
      gate.acquire(),
      gate.acquire(),
    ]);
    let queuedReady = false;

    void gate.acquire().then(() => {
      queuedReady = true;
    });
    await Promise.resolve();
    expect(gate.stats()).toEqual({ limit: 4, active: 4, waiting: 1 });

    gate.setLimit(2);
    releases[0]();
    releases[1]();
    await Promise.resolve();

    expect(queuedReady).toBe(false);
    expect(gate.stats()).toEqual({ limit: 2, active: 2, waiting: 1 });

    releases[2]();
    await Promise.resolve();
    await Promise.resolve();

    expect(queuedReady).toBe(true);
    expect(gate.stats()).toEqual({ limit: 2, active: 2, waiting: 0 });
  });

  it('等待者达到上限时直接拒绝', async () => {
    const gate = createAsyncSemaphore(1);
    const release = await gate.acquire();
    const queued = gate.acquire({ maxWaiting: 1 });

    await expect(gate.acquire({ maxWaiting: 1 })).rejects.toBeInstanceOf(
      ResourceLimitError,
    );
    expect(gate.stats().waiting).toBe(1);

    release();
    (await queued)();
    expect(gate.stats()).toMatchObject({ active: 0, waiting: 0 });
  });

  it('取消信号使排队者立即出队且不占槽位', async () => {
    const gate = createAsyncSemaphore(1);
    const release = await gate.acquire();
    const controller = new AbortController();
    const queued = gate.acquire({ signal: controller.signal });

    controller.abort();
    await expect(queued).rejects.toBeDefined();
    expect(gate.stats().waiting).toBe(0);

    release();
    expect(gate.stats().active).toBe(0);
    await expect(
      gate.acquire({ signal: controller.signal }),
    ).rejects.toBeDefined();
  });

  it('等待超时后出队并报繁忙', async () => {
    jest.useFakeTimers();
    try {
      const gate = createAsyncSemaphore(1);
      const release = await gate.acquire();
      const queued = gate.acquire({ waitTimeoutMs: 1000 });
      const assertion =
        expect(queued).rejects.toBeInstanceOf(ResourceLimitError);

      jest.advanceTimersByTime(1000);
      await assertion;
      expect(gate.stats().waiting).toBe(0);

      release();
      expect(gate.stats().active).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
