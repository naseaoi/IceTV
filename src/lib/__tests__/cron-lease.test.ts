/** @jest-environment node */

import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { acquireCronLease } from '../cron-lease';

describe('cron lease', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'icetv-cron-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('同一租约路径只允许一个持有者', async () => {
    const lockPath = join(temporaryDirectory, 'cron.lock');
    const [first, second] = await Promise.all([
      acquireCronLease({ path: lockPath, ttlMs: 10_000 }),
      acquireCronLease({ path: lockPath, ttlMs: 10_000 }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);

    await first?.release();
    await second?.release();

    const next = await acquireCronLease({ path: lockPath, ttlMs: 10_000 });
    expect(next).not.toBeNull();
    await next?.release();
  });

  it('过期租约可以被恢复', async () => {
    const lockPath = join(temporaryDirectory, 'cron.lock');
    await writeFile(
      lockPath,
      JSON.stringify({ owner: 'stale-owner', expiresAt: 900 }),
      'utf8',
    );

    const lease = await acquireCronLease({
      path: lockPath,
      ttlMs: 1_000,
      now: () => 1_000,
      owner: 'new-owner',
    });

    expect(lease).not.toBeNull();
    const content = JSON.parse(await readFile(lockPath, 'utf8')) as {
      owner: string;
    };
    expect(content.owner).toBe('new-owner');

    await lease?.release();
  });

  it('空路径关闭跨进程租约', async () => {
    const lease = await acquireCronLease({ path: null });

    expect(lease?.isHeld()).toBe(true);
    await lease?.release();
  });
});
