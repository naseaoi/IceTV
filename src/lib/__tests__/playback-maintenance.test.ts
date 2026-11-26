/** @jest-environment node */
import type Database from 'better-sqlite3';

import { runPlaybackRetention } from '@/features/playback-stats/lib/retention';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { SqliteUserAccessStore } from '@/lib/sqlite-user-access';
import {
  accessPermissionChanges,
  accessPermissions,
  publicNoticePayload,
} from '@/lib/user-notice';
import { PERMISSION_NOTICE_QUIET_MS } from '@/lib/user-notice-storage';
import type { AdminConfig } from '@/types/admin';

import {
  assertPlaybackRetentionBatches,
  assertSourceUsageAggregation,
  maintenanceSession,
} from './__fixtures__/playback-maintenance-contract';

describe('playback maintenance and config batching', () => {
  let storage: LocalSqliteStorage;
  let raw: Database.Database;
  beforeEach(() => {
    storage = new LocalSqliteStorage(':memory:');
    raw = (storage as unknown as { db: Database.Database }).db;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    raw.close();
  });

  it('preserves source usage normalization and byte-exact identities', async () => {
    await assertSourceUsageAggregation(storage);
  });

  it('deletes multiple bounded batches with their buckets', async () => {
    await assertPlaybackRetentionBatches(storage);
  });

  it('rolls back a batch if session deletion fails after bucket deletion', async () => {
    await storage.saveWatchSessionReport('rollback', maintenanceSession, [
      { start: 900000, watch_ms: 1000 },
    ]);
    raw.exec(
      "CREATE TRIGGER fail_retention BEFORE DELETE ON playback_sessions BEGIN SELECT RAISE(ABORT, 'delete failed'); END",
    );
    await expect(storage.deletePlaybackSessionsBefore(970000)).rejects.toThrow(
      'delete failed',
    );
    expect(
      raw.prepare('SELECT COUNT(*) AS count FROM playback_watch_buckets').get(),
    ).toEqual({ count: 1 });
    expect(
      raw.prepare('SELECT COUNT(*) AS count FROM playback_sessions').get(),
    ).toEqual({ count: 1 });
  });

  it('yields between batches and stops at the round budget, then continues next round', async () => {
    let clock = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => clock);
    let remaining = 1200;
    let yielded = false;
    setTimeout(() => {
      yielded = true;
    }, 0);
    const batch = jest.fn(async () => {
      const count = Math.min(500, remaining);
      remaining -= count;
      clock += 20;
      return count;
    });
    expect(await runPlaybackRetention(batch, 10)).toBe(500);
    expect(yielded).toBe(true);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(await runPlaybackRetention(batch, 100)).toBe(700);
    expect(remaining).toBe(0);
    expect(await runPlaybackRetention(batch, 0)).toBe(0);
  });

  it('uses constant read/prepare count and preserves per-user permission differences', async () => {
    const before = {
      SourceConfig: [
        { key: 'a' },
        { key: 'b' },
        { key: 'private', adminOnly: true },
      ],
      UserConfig: {
        Tags: [{ name: 'group', enabledApis: ['a'], allowLive: true }],
      },
      SiteConfig: { EnableLiveEntry: true, LiveAccess: 'groups' },
    } as AdminConfig;
    const after = {
      ...before,
      SourceConfig: [{ key: 'b', adminOnly: true }, { key: 'private' }],
      UserConfig: { Tags: [] },
    } as unknown as AdminConfig;
    const access = new SqliteUserAccessStore(raw);
    const insert = raw.prepare(
      'INSERT INTO users (username, password) VALUES (?, ?)',
    );
    for (let index = 0; index < 80; index++) {
      const username = `batch-${index}`;
      insert.run(username, 'unused');
      access.put({
        username,
        role: index % 7 ? 'user' : 'admin',
        tags: ['group'],
        enabledApis: index % 2 ? ['a'] : undefined,
      });
    }
    await storage.setAdminConfig(before);
    const original = access.list();
    const prepare = jest.spyOn(raw, 'prepare');
    await storage.compareAndSetAdminConfig(before, after);
    expect(prepare.mock.calls.length).toBeLessThan(15);
    expect(
      prepare.mock.calls.filter(([sql]) => sql.startsWith('SELECT a.username')),
    ).toHaveLength(1);
    for (const user of original) {
      const next = access.get(user.username)!;
      const expected =
        user.role === 'user'
          ? accessPermissionChanges(
              accessPermissions(user, before),
              accessPermissions(next, after),
            )
          : null;
      const notices = await storage.getUserNoticeMessages(
        user.username,
        0,
        [],
        Date.now() + PERMISSION_NOTICE_QUIET_MS + 1,
        { limit: 10 },
      );
      expect(notices.map((notice) => notice.payload)).toEqual(
        expected ? [publicNoticePayload(expected)] : [],
      );
    }
  });
});
