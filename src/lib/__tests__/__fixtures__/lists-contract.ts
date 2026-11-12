import { installCryptoPolyfill } from '@/app/api/test-utils/crypto-polyfill';
import {
  LIST_ITEM_MAX_COUNT,
  LIST_MAX_COUNT,
} from '@/features/lists/lib/limits';
import type { ListItemInput } from '@/features/lists/types';
import type { IStorage } from '@/lib/types';

installCryptoPolyfill();
export const listItem: ListItemInput = {
  title: '作品 A',
  year: '2026',
  cover: 'https://example.com/a.jpg',
  source: 'source',
  id: '1',
};
export function listsContract(
  createStorage: () => IStorage,
  reset: (storage: IStorage) => Promise<void> = async () => {},
) {
  let storage: IStorage;
  beforeEach(async () => {
    storage = createStorage();
    await reset(storage);
    await storage.registerUser('alice', 'password');
    await storage.registerUser('bobby', 'password');
  });
  afterEach(async () => {
    await reset(storage);
  });
  it('轻量计数与广场、详情、个人主页的可见范围一致', async () => {
    expect(await storage.countPlazaLists(null)).toBe(0);
    expect(
      (await storage.getUserProfileView('alice', 'alice'))?.listCount,
    ).toBe(0);
    const hidden = await storage.createList('alice', {
      name: '私密',
      item: listItem,
    });
    const members = await storage.createList('alice', {
      name: '站内',
      visibility: 'members',
      item: listItem,
    });
    const everyone = await storage.createList('alice', {
      name: '游客',
      visibility: 'everyone',
      item: listItem,
    });
    const empty = await storage.createList('alice', {
      name: '空',
      visibility: 'everyone',
    });
    for (const viewer of [null, 'bobby', 'ALICE']) {
      expect(await storage.countPlazaLists(viewer)).toBe(
        viewer === null ? 1 : 2,
      );
      expect(await storage.countPlazaLists(viewer)).toBe(
        (await storage.getPlazaLists(viewer, 'hot', null)).lists.length,
      );
      expect(await storage.getListItemCount(hidden.id, viewer)).toBe(
        viewer === 'ALICE' ? 1 : null,
      );
      expect(await storage.getListItemCount(members.id, viewer)).toBe(
        viewer === null ? null : 1,
      );
      expect(await storage.getListItemCount(everyone.id, viewer)).toBe(1);
      expect(await storage.getListItemCount(empty.id, viewer)).toBe(0);
      expect(await storage.getListItemCount('missing', viewer)).toBeNull();
    }
    for (const viewer of ['ALICE', 'bobby']) {
      const profile = await storage.getUserProfileView('alice', viewer);
      expect(profile?.listCount).toBe(viewer === 'ALICE' ? 4 : 3);
      expect(profile?.listCount).toBe(
        (await storage.getLists('alice', viewer)).length,
      );
    }
    expect((await storage.getList(everyone.id, 'alice')).list).toEqual(
      everyone,
    );
  });
  it('点赞取消幂等，不改版本时间，私密保留点赞且不可操作', async () => {
    const list = await storage.createList('alice', {
      name: '点赞',
      visibility: 'everyone',
      item: listItem,
    });
    expect(list.likeCount).toBe(0);
    for (const username of ['bobby', 'BOBBY'])
      expect(await storage.setListLike(username, list.id, true)).toEqual({
        liked: true,
        likeCount: 1,
      });
    expect((await storage.getList(list.id, 'bobby')).liked).toBe(true);
    expect((await storage.getList(list.id, null)).liked).toBe(false);
    expect((await storage.getList(list.id, 'alice')).list).toEqual({
      ...list,
      likeCount: 1,
    });
    await expect(
      storage.setListLike('alice', list.id, true),
    ).rejects.toMatchObject({ status: 400, message: '不能给自己点赞' });
    const hidden = await storage.updateList('alice', list.id, {
      visibility: 'private',
    });
    expect(hidden.likeCount).toBe(1);
    for (const liked of [true, false])
      await expect(
        storage.setListLike('bobby', list.id, liked),
      ).rejects.toMatchObject({ status: 404 });
    await expect(
      storage.setListLike(
        'bobby',
        '00000000-0000-0000-0000-000000000000',
        true,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const published = await storage.updateList('alice', list.id, {
      visibility: 'members',
    });
    expect((await storage.getList(list.id, 'bobby')).liked).toBe(true);
    for (let i = 0; i < 2; i++)
      expect(await storage.setListLike('bobby', list.id, false)).toEqual({
        liked: false,
        likeCount: 0,
      });
    expect((await storage.getList(list.id, 'alice')).list).toEqual({
      ...published,
      likeCount: 0,
    });
  });
  it.each(['delete', 'inactive'] as const)(
    '删号 %s 清除用户点赞并重算其他作者片单',
    async (mode) => {
      const list = await storage.createList('alice', {
        name: '保留',
        visibility: 'everyone',
      });
      const removed = await storage.createList('bobby', {
        name: '删除',
        visibility: 'everyone',
      });
      await storage.setListLike('bobby', list.id, true);
      await storage.setListLike('alice', removed.id, true);
      if (mode === 'delete') await storage.deleteUser('bobby');
      else
        expect(
          await storage.deleteUserIfInactive(
            'bobby',
            Date.now() + 1000,
            'operator',
          ),
        ).toBe(true);
      expect((await storage.getList(list.id, 'alice')).list).toEqual(list);
      await expect(storage.getList(removed.id, 'alice')).rejects.toMatchObject({
        status: 404,
      });
    },
  );
  it('封面只取排序前四项，作品匹配仍覆盖末尾条目', async () => {
    const list = await storage.createList('alice', {
      name: '封面',
      visibility: 'everyone',
    });
    for (let i = 0; i < 6; i++)
      await storage.addListItem('alice', list.id, {
        ...listItem,
        title: `作品 ${i}`,
        cover: `https://example.com/${i}.jpg`,
      });
    const detail = await storage.getList(list.id, 'alice');
    await storage.reorderListItems(
      'alice',
      list.id,
      detail.items.map((item) => item.id).reverse(),
      detail.list.version,
    );
    const covers = [5, 4, 3, 2].map((i) => `https://example.com/${i}.jpg`);
    expect((await storage.getLists('alice', 'alice'))[0].covers).toEqual(
      covers,
    );
    expect(
      (await storage.getPlazaLists(null, 'hot', null)).lists[0].covers,
    ).toEqual(covers);
    expect(
      (
        await storage.getLists('alice', 'alice', {
          title: '作品 0',
          year: '2026',
        })
      )[0],
    ).toMatchObject({
      covers,
      contains: true,
      containsItemId: detail.items[0].id,
    });
  });
  it('浏览量原子累加且保留排序版本和更新时间', async () => {
    const list = await storage.createList('alice', {
      name: '浏览量',
      item: listItem,
    });
    expect(list.viewCount).toBe(0);
    for (let i = 0; i < 3; i++) await storage.recordListView(list.id);
    expect((await storage.getList(list.id, 'alice')).list).toEqual({
      ...list,
      viewCount: 3,
    });
  });
  it('广场按可见等级过滤非空片单并只返回公开作者字段', async () => {
    await storage.createList('alice', { name: '私密', item: listItem });
    await storage.createList('alice', { name: '空', visibility: 'everyone' });
    const members = await storage.createList('alice', {
      name: '站内',
      visibility: 'members',
      item: listItem,
    });
    const everyone = await storage.createList('alice', {
      name: '游客',
      visibility: 'everyone',
      item: listItem,
    });
    const guest = await storage.getPlazaLists(null, 'hot', null);
    expect(guest.lists.map((list) => list.id)).toEqual([everyone.id]);
    expect(guest.nextCursor).toBeNull();
    const loggedIn = await storage.getPlazaLists('alice', 'hot', null);
    expect(loggedIn.lists.map((list) => list.id).sort()).toEqual(
      [members.id, everyone.id].sort(),
    );
    expect(guest.lists[0]).toMatchObject({
      covers: [listItem.cover],
      owner: {
        profileId: expect.any(String),
        nickname: null,
        avatarSeed: null,
      },
    });
    expect(JSON.stringify(loggedIn)).not.toContain('username');
    expect(guest.lists[0]).not.toHaveProperty('contains');
  });
  it.each(['hot', 'new'] as const)(
    '广场 %s 排序在同值边界分页保持唯一且完整',
    async (sort) => {
      const lists = [];
      const now = jest.spyOn(Date, 'now');
      try {
        for (let i = 0; i < 27; i++) {
          now.mockReturnValue(1_700_000_000_000 + (i < 2 ? i : 2));
          const list = await storage.createList('alice', {
            name: `广场 ${i}`,
            visibility: 'everyone',
            item: listItem,
          });
          for (let j = 0; j < Math.min(i, 2); j++)
            await storage.recordListView(list.id);
          const likeCount = i === 0 || i >= 3 ? 1 : 0;
          if (likeCount) await storage.setListLike('bobby', list.id, true);
          lists.push({ ...list, viewCount: Math.min(i, 2), likeCount });
        }
      } finally {
        now.mockRestore();
      }
      lists.sort(
        (a, b) =>
          (sort === 'hot'
            ? b.viewCount + b.likeCount * 10 - a.viewCount - a.likeCount * 10
            : b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id),
      );
      const first = await storage.getPlazaLists(null, sort, null);
      expect(first.lists).toHaveLength(24);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = await storage.getPlazaLists(null, sort, first.nextCursor);
      expect(second.lists).toHaveLength(3);
      expect(second.nextCursor).toBeNull();
      expect([...first.lists, ...second.lists].map((list) => list.id)).toEqual(
        lists.map((list) => list.id),
      );
      await expect(
        storage.getPlazaLists(
          null,
          sort === 'hot' ? 'new' : 'hot',
          first.nextCursor,
        ),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it.each([
    '',
    'garbage',
    Buffer.from(JSON.stringify(['hot', -1, 'bad'])).toString('base64url'),
  ])('广场拒绝非法游标 %s', async (cursor) => {
    await expect(
      storage.getPlazaLists(null, 'hot', cursor),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('隔离、公开访问与不透明身份', async () => {
    const list = await storage.createList('ALICE', {
      name: '片单',
      item: listItem,
    });
    expect(list.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(list.itemCount).toBe(1);
    await expect(storage.getList(list.id, 'bobby')).rejects.toMatchObject({
      status: 404,
    });
    expect(await storage.getLists('alice', 'bobby')).toEqual([]);
    await expect(
      storage.updateList('bobby', list.id, { name: '越权' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      storage.addListItem('bobby', list.id, listItem),
    ).rejects.toMatchObject({ status: 404 });
    await expect(storage.getList(list.id, null)).rejects.toMatchObject({
      status: 404,
    });
    const published = await storage.updateList('alice', list.id, {
      visibility: 'members',
    });
    expect(published).toMatchObject({
      visibility: 'members',
      version: list.version + 1,
    });
    expect(await storage.getLists('alice', 'bobby')).toHaveLength(1);
    expect((await storage.getList(list.id, 'bobby')).items).toHaveLength(1);
    await expect(storage.getList(list.id, null)).rejects.toMatchObject({
      status: 404,
    });
    await storage.updateList('alice', list.id, { visibility: 'everyone' });
    expect(await storage.getLists('alice', 'bobby')).toHaveLength(1);
    expect((await storage.getList(list.id, null)).items).toHaveLength(1);
  });
  it('重复作品精确年份幂等、封面与包含条目编号', async () => {
    const list = await storage.createList('alice', { name: '片单' });
    const first = await storage.addListItem('alice', list.id, listItem);
    const duplicate = await storage.addListItem('alice', list.id, {
      ...listItem,
      title: '作品.a',
      source: 'other',
    });
    expect(duplicate).toEqual(first);
    await storage.addListItem('alice', list.id, { ...listItem, year: '' });
    const [summary] = await storage.getLists('alice', 'alice', {
      title: '作品 a',
      year: '2026',
    });
    expect(summary).toMatchObject({
      contains: true,
      containsItemId: first.item.id,
      itemCount: 2,
      covers: [listItem.cover, listItem.cover],
    });
    expect(
      (
        await storage.getLists('alice', 'alice', {
          title: '另一作品',
          year: '',
        })
      )[0],
    ).toMatchObject({ contains: false, containsItemId: null });
  });
  it('排序要求全量条目和当前版本，失败回滚，删除维护计数', async () => {
    const list = await storage.createList('alice', {
      name: '片单',
      item: listItem,
    });
    const first = (await storage.getList(list.id, 'alice')).items[0];
    const second = await storage.addListItem('alice', list.id, {
      ...listItem,
      title: '作品 B',
    });
    await expect(
      storage.reorderListItems('alice', list.id, [first.id], list.version),
    ).rejects.toMatchObject({ status: 409, code: 'LIST_VERSION_CONFLICT' });
    for (const ids of [[first.id], [first.id, first.id], [first.id, 'missing']])
      await expect(
        storage.reorderListItems('alice', list.id, ids, second.list.version),
      ).rejects.toMatchObject({ status: 400 });
    const sorted = await storage.reorderListItems(
      'alice',
      list.id,
      [second.item.id, first.id],
      second.list.version,
    );
    expect(sorted.version).toBe(second.list.version + 1);
    expect(
      (await storage.getList(list.id, 'alice')).items.map((item) => item.id),
    ).toEqual([second.item.id, first.id]);
    const removed = await storage.removeListItem('alice', list.id, first.id);
    expect(removed).toMatchObject({
      itemCount: 1,
      version: sorted.version + 1,
    });
    await storage.deleteList('alice', list.id);
    expect(await storage.countUserLists('alice')).toBe(0);
    await expect(storage.getList(list.id, 'alice')).rejects.toMatchObject({
      status: 404,
    });
  });
  it('片单和条目上限在事务内检查，满额重复依然成功', async () => {
    const list = await storage.createList('alice', { name: '片单' });
    for (let i = 0; i < LIST_ITEM_MAX_COUNT; i++)
      await storage.addListItem('alice', list.id, {
        ...listItem,
        title: `作品 ${i}`,
      });
    await expect(
      storage.addListItem('alice', list.id, listItem),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (
        await storage.addListItem('alice', list.id, {
          ...listItem,
          title: '作品 0',
        })
      ).list.itemCount,
    ).toBe(LIST_ITEM_MAX_COUNT);
    for (let i = 1; i < LIST_MAX_COUNT; i++)
      await storage.createList('alice', { name: `片单 ${i}` });
    await expect(
      storage.createList('alice', { name: '超出上限' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await storage.countUserLists('alice')).toBe(LIST_MAX_COUNT);
  }, 30_000);
  it('非法首条目回滚创建、目录快照不绑定来源编号', async () => {
    await expect(
      storage.createList('alice', {
        name: '无效',
        item: { ...listItem, cover: 'javascript:alert(1)' },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await storage.countUserLists('alice')).toBe(0);
    const list = await storage.createList('alice', {
      name: '目录',
      item: { ...listItem, source: 'douban' },
    });
    expect(
      (await storage.getList(list.id, 'alice')).items[0].sourceId,
    ).toBeNull();
    await storage.deleteAllFavorites('alice');
    expect((await storage.getList(list.id, 'alice')).items).toHaveLength(1);
  });
  it('删号和非活跃清理同时删除片单和作品', async () => {
    const list = await storage.createList('alice', {
      name: '片单',
      item: listItem,
    });
    await storage.deleteUser('alice');
    expect(await storage.countUserLists('alice')).toBe(0);
    await expect(storage.getList(list.id, 'alice')).rejects.toMatchObject({
      status: 404,
    });
    const inactive = await storage.createList('bobby', {
      name: '闲置',
      item: listItem,
    });
    expect(
      await storage.deleteUserIfInactive(
        'bobby',
        Date.now() + 1000,
        'operator',
      ),
    ).toBe(true);
    await expect(storage.getList(inactive.id, 'bobby')).rejects.toMatchObject({
      status: 404,
    });
  });
}
