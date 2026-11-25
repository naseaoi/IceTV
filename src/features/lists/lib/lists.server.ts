import { NextRequest, NextResponse } from 'next/server';

import type {
  CreateListInput,
  ListItem,
  ListItemInput,
  ListPatch,
  ListSummary,
  SavedListSummary,
} from '@/features/lists/types';
import {
  getOptionalActiveUser,
  isGuardFailure,
  requireActiveUser,
} from '@/lib/api-auth';
import { getClientIp } from '@/lib/client-ip';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { writeListCountCookieOnResponse } from '@/lib/list-count-cookies';
import { requireNickname } from '@/lib/user-profile.server';
import { normalizeUsername } from '@/lib/username';

import {
  filterListSummaries,
  getBlockedListSources,
  visibleListItems,
  visibleListSummary,
} from './list-content-policy.server';
import { ListError, listNotFound } from './list-storage';
import { listViewCounter } from './list-view-counter';

type Context = { params: Promise<{ id: string; itemId?: string }> };
type Action =
  | 'collection'
  | 'detail'
  | 'items'
  | 'item'
  | 'order'
  | 'plaza'
  | 'like';
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: NO_STORE_HEADERS });
}
async function visibleMutation(
  result: { list: ListSummary; item?: ListItem },
  username: string,
) {
  const [list] = await filterListSummaries([result.list], username);
  if (result.item && (await getBlockedListSources()).has(result.item.source)) {
    throw new ListError('该来源不可用', 403);
  }
  return json({ ...result, list });
}
async function checkItemSource(input: unknown) {
  if (
    input &&
    typeof input === 'object' &&
    'source' in input &&
    typeof input.source === 'string' &&
    (await getBlockedListSources()).has(input.source.trim())
  ) {
    throw new ListError('该来源不可用', 403);
  }
}
async function body(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ListError('请求体必须为有效 JSON 对象');
  }
}
async function detailResponse(
  id: string,
  viewer: string | null,
  request: NextRequest,
) {
  const detail = await db.getList(id, viewer);
  detail.items = visibleListItems(detail.items, await getBlockedListSources());
  detail.list = visibleListSummary(detail.list, detail.items);
  const profile = await db.getUserProfile(detail.username);
  if (!profile) listNotFound();
  if (detail.username !== viewer) {
    try {
      const ip = viewer === null ? getClientIp(request) : null;
      const visitor =
        viewer !== null
          ? `user:${viewer}`
          : ip && ip !== 'unknown'
            ? `ip:${ip}`
            : null;
      if (
        visitor &&
        (await listViewCounter.record(id, visitor, () => db.recordListView(id)))
      )
        detail.list.viewCount += 1;
    } catch (error) {
      console.error('片单浏览计数失败', error);
    }
  }
  const statuses =
    viewer !== null
      ? await db.getWorkWatchStatuses(viewer, detail.items)
      : null;
  const items = detail.items.map((item, index) =>
    statuses ? { ...item, viewerStatus: statuses[index] } : item,
  );
  const nextIndex = statuses
    ? statuses.findIndex((status) => status === 'watching')
    : -1;
  return json({
    list: detail.list,
    items,
    ...(statuses
      ? {
          viewerProgress: {
            completed: statuses.filter((status) => status === 'completed')
              .length,
            total: detail.items.length,
            nextItemId:
              detail.items[
                nextIndex >= 0
                  ? nextIndex
                  : statuses.findIndex((status) => status !== 'completed')
              ]?.id ?? null,
          },
        }
      : {}),
    liked: detail.liked,
    isOwner: detail.username === viewer,
    owner: {
      profileId: profile.profile_id,
      nickname: profile.nickname,
      avatarSeed: profile.avatar_seed,
      level: profile.level ?? 1,
    },
  });
}
export async function handleLists(
  request: NextRequest,
  action: Action,
  context?: Context,
) {
  try {
    if (action === 'plaza' && request.method === 'GET') {
      const viewer = await getOptionalActiveUser(request);
      const query = request.nextUrl.searchParams;
      const sort = query.get('sort') ?? 'hot';
      if (sort !== 'hot' && sort !== 'new')
        throw new ListError('排序方式不正确');
      const username = viewer ? normalizeUsername(viewer.username) : null;
      const page = await db.getPlazaLists(username, sort, query.get('cursor'));
      page.lists = await filterListSummaries(page.lists, username);
      return json(page);
    }
    const params = context ? await context.params : undefined;
    if (
      params &&
      (!/^[a-f0-9-]{36}$/.test(params.id) ||
        (params.itemId !== undefined && !/^[a-f0-9-]{36}$/.test(params.itemId)))
    )
      listNotFound();
    const id = params?.id ?? '';
    // 片单详情对游客开放，存储层只返回对所有人可见的片单
    if (action === 'detail' && request.method === 'GET') {
      const viewer = await getOptionalActiveUser(request);
      return await detailResponse(
        id,
        viewer ? normalizeUsername(viewer.username) : null,
        request,
      );
    }
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const username = normalizeUsername(guard.username);
    if (action === 'like' && ['PUT', 'DELETE'].includes(request.method)) {
      const nicknameFailure = await requireNickname(username);
      if (nicknameFailure) return nicknameFailure;
      const response = json(
        await db.setListLike(username, id, request.method === 'PUT'),
      );
      writeListCountCookieOnResponse(
        response,
        'saved_list_count',
        await db.countSavedLists(username),
      );
      return response;
    }
    if (action === 'collection' && request.method === 'GET') {
      const query = request.nextUrl.searchParams;
      const scope = query.get('scope');
      if (scope !== null && scope !== 'saved')
        throw new ListError('片单范围不正确');
      if (scope === 'saved') {
        if (['profileId', 'title', 'year'].some((key) => query.has(key)))
          throw new ListError('收藏片单仅支持读取本人收藏');
        const saved = await db.getSavedLists(username);
        const available = await filterListSummaries(
          saved.filter(
            (
              entry,
            ): entry is Extract<SavedListSummary, { status: 'available' }> =>
              entry.status === 'available',
          ),
          username,
        );
        const byId = new Map(available.map((entry) => [entry.id, entry]));
        const lists = saved.map((entry) =>
          entry.status === 'available' ? byId.get(entry.id)! : entry,
        );
        const response = json({ lists });
        writeListCountCookieOnResponse(
          response,
          'saved_list_count',
          lists.length,
        );
        return response;
      }
      const profileId = query.get('profileId');
      let owner = username;
      if (profileId !== null) {
        if (!/^[a-zA-Z0-9]{12}$/.test(profileId)) listNotFound();
        const profile = await db.getUserProfileById(profileId);
        if (!profile) listNotFound();
        owner = profile.username;
      }
      let work: { title: string; year: string } | undefined;
      if (query.has('title') || query.has('year')) {
        if (!query.has('title') || !query.has('year'))
          throw new ListError('请提供作品标题和年份');
        work = { title: query.get('title')!, year: query.get('year')! };
      }
      return json({
        lists: await filterListSummaries(
          await db.getLists(owner, username, work),
          username,
        ),
      });
    }
    if (action === 'collection' && request.method === 'POST') {
      const input = await body(request);
      await checkItemSource(input.item);
      await db.ensureUserProfile(username);
      return await visibleMutation(
        {
          list: await db.createList(
            username,
            input as unknown as CreateListInput,
          ),
        },
        username,
      );
    }
    if (action === 'detail' && request.method === 'PATCH')
      return await visibleMutation(
        {
          list: await db.updateList(
            username,
            id,
            (await body(request)) as ListPatch,
          ),
        },
        username,
      );
    if (action === 'detail' && request.method === 'DELETE') {
      await db.deleteList(username, id);
      return json({ ok: true });
    }
    if (action === 'items' && request.method === 'POST') {
      const input = await body(request);
      await checkItemSource(input);
      return await visibleMutation(
        await db.addListItem(username, id, input as unknown as ListItemInput),
        username,
      );
    }
    if (action === 'item' && request.method === 'DELETE')
      return await visibleMutation(
        {
          list: await db.removeListItem(username, id, params!.itemId!),
        },
        username,
      );
    if (action === 'order' && request.method === 'PUT') {
      const input = await body(request);
      const blocked = await getBlockedListSources();
      let itemIds = input.itemIds as string[];
      if (blocked.size > 0 && Array.isArray(itemIds)) {
        const detail = await db.getList(id, username);
        const visible = visibleListItems(detail.items, blocked);
        if (
          itemIds.length === visible.length &&
          new Set(itemIds).size === visible.length &&
          itemIds.every((key) => visible.some((item) => item.id === key))
        ) {
          let index = 0;
          itemIds = detail.items.map((item) =>
            blocked.has(item.source) ? item.id : itemIds[index++],
          );
        }
      }
      return await visibleMutation(
        {
          list: await db.reorderListItems(
            username,
            id,
            itemIds,
            input.version as number,
          ),
        },
        username,
      );
    }
    return json({ error: '请求方法不支持' }, 405);
  } catch (error) {
    if (error instanceof ListError)
      return json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        error.status,
      );
    console.error('片单操作失败', error);
    return json({ error: '片单操作失败，请稍后重试' }, 500);
  }
}
