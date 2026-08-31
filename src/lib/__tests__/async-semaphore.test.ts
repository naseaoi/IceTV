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
});
