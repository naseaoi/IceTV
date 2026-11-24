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

  it('先按本人和当前集过滤再分页，较早弹幕不受全站窗口挤占', async () => {
    for (let index = 0; index < 160; index++) {
      await storage.addUserDanmaku({
        ...userDanmaku,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        username: index < 55 || index >= 110 ? 'alice' : 'bob',
        episodeKey: index >= 110 ? 'dandan:456' : 'dandan:123',
        createdAt: index < 55 ? 1000 + (index % 3) : 2000,
      });
    }
    expect(
      (await storage.getUserDanmaku('dandan:123', 50)).every(
        (row) => row.username === 'bob',
      ),
    ).toBe(true);
    const query = { username: 'ALICE', episodeKey: 'dandan:123' };
    const first = await storage.getUserDanmakuPage(query);
    expect(first).toHaveLength(51);
    expect(
      first.every(
        (row) =>
          row.username === 'alice' && row.episodeKey === query.episodeKey,
      ),
    ).toBe(true);
    const last = first[49];
    const second = await storage.getUserDanmakuPage({
      ...query,
      cursor: { createdAt: last.createdAt, id: last.id },
    });
    expect(second).toHaveLength(5);
    const expected = Array.from({ length: 55 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      createdAt: 1000 + (index % 3),
    })).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    expect([...first.slice(0, 50), ...second].map((row) => row.id)).toEqual(
      expected.map((row) => row.id),
    );
    expect(first[50].id).toBe(second[0].id);
    const end = second.at(-1)!;
    expect(
      await storage.getUserDanmakuPage({
        ...query,
        cursor: { createdAt: end.createdAt, id: end.id },
      }),
    ).toEqual([]);
    expect(
      await storage.getUserDanmakuPage({ ...query, episodeKey: 'DANDAN:123' }),
    ).toEqual([]);
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
