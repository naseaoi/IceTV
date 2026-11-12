import { NextRequest, NextResponse } from 'next/server';

import type {
  CreateListInput,
  ListItemInput,
  ListPatch,
} from '@/features/lists/types';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { normalizeUsername } from '@/lib/username';

import { ListError, listNotFound } from './list-storage';

type Context = { params: Promise<{ id: string; itemId?: string }> };
type Action = 'collection' | 'detail' | 'items' | 'item' | 'order';
function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: NO_STORE_HEADERS });
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
export async function handleLists(
  request: NextRequest,
  action: Action,
  context?: Context,
) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    const username = normalizeUsername(guard.username);
    const params = context ? await context.params : undefined;
    if (
      params &&
      (!/^[a-f0-9-]{36}$/.test(params.id) ||
        (params.itemId !== undefined && !/^[a-f0-9-]{36}$/.test(params.itemId)))
    )
      listNotFound();
    const id = params?.id ?? '';
    if (action === 'collection' && request.method === 'GET') {
      const query = request.nextUrl.searchParams;
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
      return json({ lists: await db.getLists(owner, username, work) });
    }
    if (action === 'collection' && request.method === 'POST') {
      const input = await body(request);
      await db.ensureUserProfile(username);
      return json({
        list: await db.createList(
          username,
          input as unknown as CreateListInput,
        ),
      });
    }
    if (action === 'detail' && request.method === 'GET') {
      const detail = await db.getList(id, username);
      const profile = await db.getUserProfile(detail.username);
      if (!profile) listNotFound();
      return json({
        list: detail.list,
        items: detail.items,
        isOwner: detail.username === username,
        owner: {
          profileId: profile.profile_id,
          nickname: profile.nickname,
          avatarSeed: profile.avatar_seed,
        },
      });
    }
    if (action === 'detail' && request.method === 'PATCH')
      return json({
        list: await db.updateList(
          username,
          id,
          (await body(request)) as ListPatch,
        ),
      });
    if (action === 'detail' && request.method === 'DELETE') {
      await db.deleteList(username, id);
      return json({ ok: true });
    }
    if (action === 'items' && request.method === 'POST')
      return json(
        await db.addListItem(
          username,
          id,
          (await body(request)) as unknown as ListItemInput,
        ),
      );
    if (action === 'item' && request.method === 'DELETE')
      return json({
        list: await db.removeListItem(username, id, params!.itemId!),
      });
    if (action === 'order' && request.method === 'PUT') {
      const input = await body(request);
      return json({
        list: await db.reorderListItems(
          username,
          id,
          input.itemIds as string[],
          input.version as number,
        ),
      });
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
