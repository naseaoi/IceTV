import { createAsyncSemaphore } from '@/lib/async-semaphore';

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
});
