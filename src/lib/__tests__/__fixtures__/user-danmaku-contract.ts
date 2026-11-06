import type { IStorage } from '@/lib/types';
import type { StoredUserDanmaku } from '@/lib/user-danmaku-storage';
import type { AdminConfig } from '@/types/admin';

export const userDanmaku: StoredUserDanmaku = {
  id: '00000000-0000-4000-8000-000000000001',
  episodeKey: 'dandan:123',
  username: 'alice',
  timeMs: 1234,
  text: 'Hello 100%_!',
  mode: 1,
  color: '#abcdef',
  createdAt: 1000,
};

export function userDanmakuContract(
  createStorage: () => IStorage,
  adminConfig: AdminConfig,
) {
  let storage: IStorage;
  beforeEach(async () => {
    storage = createStorage();
    await storage.clearAllData();
  });
  afterEach(async () => {
    await storage.clearAllData();
  });

  it('stores exact keys, canonical users and newest N; restricts owner deletion', async () => {
    await storage.addUserDanmaku({ ...userDanmaku, username: 'ALICE' });
    await storage.addUserDanmaku({
      ...userDanmaku,
      id: '00000000-0000-4000-8000-000000000002',
      timeMs: 1,
      createdAt: 2000,
    });
    const newest = await storage.getUserDanmaku('dandan:123', 1);
    expect(newest).toHaveLength(1);
    expect(newest[0].timeMs).toBe(1);
    expect(await storage.getUserDanmaku('DANDAN:123', 5)).toEqual([]);
    expect(await storage.getAllUserDanmaku('Alice')).toHaveLength(2);
    expect(await storage.deleteUserDanmaku(userDanmaku.id, 'bob')).toBe(false);
    expect(await storage.deleteUserDanmaku(userDanmaku.id, 'ALICE')).toBe(true);
    expect(await storage.deleteUserDanmaku(userDanmaku.id, 'alice')).toBe(
      false,
    );
  });

  it('paginates timestamp ties, searches literal wildcards or username and batch deletes', async () => {
    for (let i = 0; i < 55; i++) {
      await storage.addUserDanmaku({
        ...userDanmaku,
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        text: i === 0 ? 'Hello 100%_!' : 'other',
      });
    }
    const first = await storage.getUserDanmakuPage({});
    expect(first).toHaveLength(51);
    const last = first[49];
    const second = await storage.getUserDanmakuPage({
      cursor: { id: last.id, createdAt: last.createdAt },
    });
    expect(second).toHaveLength(5);
    expect(
      new Set([...first.slice(0, 50), ...second].map((row) => row.id)).size,
    ).toBe(55);
    expect(await storage.getUserDanmakuPage({ q: '%_!' })).toHaveLength(1);
    expect(await storage.getUserDanmakuPage({ q: 'ALICE' })).toHaveLength(51);
    expect(await storage.getUserDanmakuPage({ username: 'bob' })).toEqual([]);
    expect(
      await storage.deleteUserDanmakuBatch([
        first[0].id,
        first[1].id,
        first[0].id,
      ]),
    ).toBe(2);
    expect(await storage.deleteUserDanmakuBatch([])).toBe(0);
  });

  it('deletes user data and restores only imported rows; clears all data', async () => {
    await storage.registerUser('alice', 'password');
    await storage.addUserDanmaku(userDanmaku);
    await storage.deleteUser('alice');
    expect(await storage.getAllUserDanmaku('alice')).toEqual([]);
    await storage.addUserDanmaku(userDanmaku);
    await storage.replaceAllData({
      adminConfig,
      users: {},
      sourceRouteStats: [],
      inviteCodeUsage: {},
      userData: {
        owner: {
          playRecords: {},
          favorites: {},
          searchHistory: [],
          skipConfigs: {},
          playbackSessions: {},
          userDanmaku: [
            { ...userDanmaku, id: '00000000-0000-4000-8000-000000000099' },
          ],
        },
      },
    });
    expect(await storage.getAllUserDanmaku('alice')).toEqual([]);
    expect(await storage.getAllUserDanmaku('owner')).toEqual([
      {
        ...userDanmaku,
        username: 'owner',
        id: '00000000-0000-4000-8000-000000000099',
      },
    ]);
    await storage.clearAllData();
    expect(await storage.getUserDanmakuPage({})).toEqual([]);
  });
}
