import type {
  CreateListInput,
  ListDetail,
  ListItem,
  ListItemInput,
  ListLikeState,
  ListPatch,
  ListSummary,
  PlazaListSummary,
  PlazaPage,
  PlazaSort,
} from '@/features/lists/types';
import { socialRequest } from '@/lib/profile.client';

export type {
  ListDetail,
  ListItem,
  ListItemInput,
  ListSummary,
} from '@/features/lists/types';

// 已拿到的片单摘要，详情页加载期间据此先渲染标题、简介与条目数量
const SUMMARY_CACHE_LIMIT = 100;
const summaryCache = new Map<string, ListSummary>();

function remember(list: ListSummary): ListSummary {
  summaryCache.delete(list.id);
  summaryCache.set(list.id, list);
  if (summaryCache.size > SUMMARY_CACHE_LIMIT) {
    summaryCache.delete(summaryCache.keys().next().value as string);
  }
  return list;
}

export function peekListSummary(id: string): ListSummary | null {
  return summaryCache.get(id) ?? null;
}

function request<T>(path: string, init?: RequestInit): Promise<T> {
  return socialRequest<T>(`/api/lists${path}`, { cache: 'no-store', ...init });
}
function mutation(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
const pathFor = (id: string) => `/${encodeURIComponent(id)}`;
export async function fetchMyLists(
  work?: { title: string; year: string },
  signal?: AbortSignal,
): Promise<ListSummary[]> {
  const query = new URLSearchParams(work);
  const { lists } = await request<{ lists: ListSummary[] }>(`?${query}`, {
    signal,
  });
  lists.forEach(remember);
  return lists;
}
export async function fetchProfileLists(
  profileId: string,
  signal?: AbortSignal,
): Promise<ListSummary[]> {
  const { lists } = await request<{ lists: ListSummary[] }>(
    `?${new URLSearchParams({ profileId })}`,
    { signal },
  );
  lists.forEach(remember);
  return lists;
}
export async function fetchPlazaLists(
  sort: PlazaSort,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<{ items: PlazaListSummary[]; nextCursor: string | null }> {
  const query = new URLSearchParams({ sort, ...(cursor ? { cursor } : {}) });
  const page = await request<PlazaPage>(`/plaza?${query}`, { signal });
  page.lists.forEach(remember);
  return { items: page.lists, nextCursor: page.nextCursor };
}
export async function setListLiked(
  id: string,
  liked: boolean,
): Promise<ListLikeState> {
  const state = await request<ListLikeState>(`${pathFor(id)}/like`, {
    method: liked ? 'PUT' : 'DELETE',
  });
  const cached = summaryCache.get(id);
  if (cached) remember({ ...cached, likeCount: state.likeCount });
  return state;
}
export async function createList(input: CreateListInput): Promise<ListSummary> {
  return remember(
    (await request<{ list: ListSummary }>('', mutation('POST', input))).list,
  );
}
export async function fetchList(
  id: string,
  signal?: AbortSignal,
): Promise<ListDetail> {
  const detail = await request<ListDetail>(pathFor(id), { signal });
  remember(detail.list);
  return detail;
}
export async function updateList(
  id: string,
  patch: ListPatch,
): Promise<ListSummary> {
  return remember(
    (
      await request<{ list: ListSummary }>(
        pathFor(id),
        mutation('PATCH', patch),
      )
    ).list,
  );
}
export async function deleteList(id: string): Promise<void> {
  await request(pathFor(id), { method: 'DELETE' });
  summaryCache.delete(id);
}
export async function addListItem(
  id: string,
  item: ListItemInput,
): Promise<{ item: ListItem; list: ListSummary }> {
  const result = await request<{ item: ListItem; list: ListSummary }>(
    `${pathFor(id)}/items`,
    mutation('POST', item),
  );
  remember(result.list);
  return result;
}
export async function removeListItem(
  id: string,
  itemId: string,
): Promise<ListSummary> {
  return remember(
    (
      await request<{ list: ListSummary }>(
        `${pathFor(id)}/items/${encodeURIComponent(itemId)}`,
        { method: 'DELETE' },
      )
    ).list,
  );
}
export async function reorderListItems(
  id: string,
  itemIds: string[],
  version: number,
): Promise<ListSummary> {
  return remember(
    (
      await request<{ list: ListSummary }>(
        `${pathFor(id)}/order`,
        mutation('PUT', { itemIds, version }),
      )
    ).list,
  );
}
