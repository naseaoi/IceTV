import { socialRequest } from '@/lib/profile.client';
import { DisplayableError } from '@/lib/user-facing-error';

import {
  addListItem,
  createList,
  deleteList,
  fetchList,
  fetchMyLists,
  fetchProfileLists,
  peekListSummary,
  removeListItem,
  reorderListItems,
  updateList,
} from './lists-client';

jest.mock('@/lib/profile.client', () => ({ socialRequest: jest.fn() }));
const fetchMock = jest.mocked(socialRequest);
beforeEach(() => fetchMock.mockReset());
function respond(data: unknown) {
  fetchMock.mockResolvedValue(data);
}
it('片单列表参数编码、可取消读取', async () => {
  respond({ lists: [] });
  const signal = new AbortController().signal;
  await fetchMyLists({ title: 'A & B', year: '' }, signal);
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/lists?title=A+%26+B&year=',
    expect.objectContaining({ signal, cache: 'no-store' }),
  );
  await fetchProfileLists('profile', signal);
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/lists?profileId=profile',
    expect.objectContaining({ signal }),
  );
});
it('请求函数与路径、方法一一对应', async () => {
  const list = { id: 'list' };
  const item = { title: '作品', year: '', cover: '', source: '', id: null };
  respond({ list, item });
  expect(await createList({ name: '新片单', item })).toEqual(list);
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/lists',
    expect.objectContaining({ method: 'POST' }),
  );
  expect(await updateList('list', { isPublic: true })).toEqual(list);
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/lists/list',
    expect.objectContaining({ method: 'PATCH' }),
  );
  expect(await addListItem('list', item)).toEqual({ list, item });
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/lists/list/items',
    expect.objectContaining({ method: 'POST' }),
  );
  expect(await removeListItem('list', 'item')).toEqual(list);
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/lists/list/items/item',
    expect.objectContaining({ method: 'DELETE' }),
  );
  expect(await reorderListItems('list', ['item'], 2)).toEqual(list);
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/lists/list/order',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ itemIds: ['item'], version: 2 }),
    }),
  );
  await deleteList('list');
  expect(fetchMock).toHaveBeenLastCalledWith(
    '/api/lists/list',
    expect.objectContaining({ method: 'DELETE' }),
  );
});
it('请求错误原样抛给调用方', async () => {
  const conflict = new DisplayableError('片单已更新', {
    status: 409,
    code: 'LIST_VERSION_CONFLICT',
  });
  fetchMock.mockRejectedValue(conflict);
  await expect(reorderListItems('list', [], 1)).rejects.toBe(conflict);
});
it('读取与写入后记住片单摘要，删除后清除', async () => {
  respond({ lists: [{ id: 'a', itemCount: 3 }] });
  await fetchProfileLists('profile');
  expect(peekListSummary('a')).toEqual({ id: 'a', itemCount: 3 });
  respond({
    list: { id: 'a', itemCount: 2 },
    owner: {},
    isOwner: false,
    items: [],
  });
  await fetchList('a');
  expect(peekListSummary('a')?.itemCount).toBe(2);
  respond({});
  await deleteList('a');
  expect(peekListSummary('a')).toBeNull();
});
