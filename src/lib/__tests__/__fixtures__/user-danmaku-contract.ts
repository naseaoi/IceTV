import type { IStorage } from '@/lib/types';
import type { StoredUserDanmaku } from '@/lib/user-danmaku-storage';

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
  reset: (storage: IStorage) => Promise<void> = async () => {},
) {
  let storage: IStorage;
  beforeEach(async () => {
    storage = createStorage();
    await reset(storage);
  });
  afterEach(async () => {
    await reset(storage);
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

  it('删除用户时同步清理本人弹幕并保留其他用户数据', async () => {
    await storage.registerUser('alice', 'password');
    await storage.addUserDanmaku(userDanmaku);
    const other = {
      ...userDanmaku,
      id: '00000000-0000-4000-8000-000000000099',
      username: 'owner',
    };
    await storage.addUserDanmaku(other);
    await storage.deleteUser('alice');
    expect(await storage.getAllUserDanmaku('alice')).toEqual([]);
    expect(await storage.getAllUserDanmaku('owner')).toEqual([other]);
  });
}
