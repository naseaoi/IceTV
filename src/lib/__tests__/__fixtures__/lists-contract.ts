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
    const published = await storage.updateList('alice', list.id, {
      isPublic: true,
    });
    expect(published.version).toBe(list.version + 1);
    expect(await storage.getLists('alice', 'bobby')).toHaveLength(1);
    expect((await storage.getList(list.id, 'bobby')).items).toHaveLength(1);
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
