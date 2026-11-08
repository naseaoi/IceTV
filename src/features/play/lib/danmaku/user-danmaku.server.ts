import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import {
  isGuardFailure,
  requireActiveUser,
  requireAdmin,
} from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import { db } from '@/lib/db';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import {
  consumeSharedQuota,
  resourceKey,
  sharedResourceStore,
} from '@/lib/shared-resource-quota.server';
import {
  type UserDanmakuItem,
  ADMIN_USER_DANMAKU_DELETE_LIMIT,
  ADMIN_USER_DANMAKU_PAGE_SIZE,
  isValidUserDanmakuKey,
  normalizeUserDanmakuColor,
  normalizeUserDanmakuMode,
  normalizeUserDanmakuText,
  userDanmakuReadLimit,
} from '@/lib/user-danmaku';
import type {
  StoredUserDanmaku,
  UserDanmakuCursor,
} from '@/lib/user-danmaku-storage';
import { normalizeUsername } from '@/lib/username';

const MAX_BODY_BYTES = 16 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class InputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

function failure(error: unknown) {
  if (error instanceof InputError)
    return json({ error: error.message }, error.status);
  if (error instanceof ResourceLimitError) {
    return json(
      {
        error:
          error.status === 429
            ? '发送太频繁，请稍后再试'
            : '服务繁忙，请稍后重试',
      },
      error.status,
      {
        'Retry-After': String(Math.max(1, Math.ceil(error.retryAfterSeconds))),
      },
    );
  }
  console.error('用户弹幕操作失败', error);
  return json({ error: '弹幕操作失败，请稍后重试' }, 500);
}

// Cookie 沿用项目的 SameSite=Lax；显式拒绝浏览器跨站写请求。
// 反代或开发服务器下 nextUrl.origin 是内部地址，不能拿来和浏览器 Origin 比较
function checkWriteOrigin(request: NextRequest) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new InputError('请求来源无效', 403);
  }
}

async function jsonBody(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY_BYTES) throw new InputError('请求体过大', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('请求体必须为有效 JSON');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InputError('请求体过大', 413);
      }
      chunks.push(value);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error();
    return input as Record<string, unknown>;
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('请求体必须为有效 JSON');
  } finally {
    reader.releaseLock();
  }
}

function item(row: StoredUserDanmaku, username: string): UserDanmakuItem {
  return {
    id: row.id,
    time: row.timeMs / 1000,
    text: row.text,
    mode: row.mode,
    color: row.color,
    mine: row.username === username,
  };
}

function validId(id: unknown): id is string {
  return typeof id === 'string' && UUID_PATTERN.test(id);
}

function decodeCursor(value: string | null): UserDanmakuCursor | undefined {
  if (!value) return undefined;
  try {
    if (value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error();
    const input = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !input ||
      !validId(input.id) ||
      !Number.isSafeInteger(input.createdAt) ||
      input.createdAt < 0
    )
      throw new Error();
    return { id: input.id, createdAt: input.createdAt };
  } catch {
    throw new InputError('分页游标无效');
  }
}

export async function handleUserDanmaku(request: NextRequest) {
  try {
    const guard = await requireActiveUser(request, {
      unauthorizedMessage: '请先登录',
    });
    if (isGuardFailure(guard)) return guard.response;
    const username = normalizeUsername(guard.username);
    if (request.method !== 'GET') checkWriteOrigin(request);
    if (request.method === 'DELETE') {
      const id = request.nextUrl.searchParams.get('id');
      if (!validId(id)) throw new InputError('弹幕标识无效');
      if (!(await db.deleteUserDanmaku(id, username)))
        return json({ error: '弹幕不存在' }, 404);
      return json({ deleted: 1 });
    }
    const { SiteConfig: site } = await getConfigForRead();
    if (!site.EnableDanmaku || !site.EnableUserDanmaku)
      return json({ error: '用户弹幕已关闭' }, 403);
    if (request.method === 'GET') {
      const key = request.nextUrl.searchParams.get('key');
      if (!isValidUserDanmakuKey(key)) throw new InputError('弹幕集标识无效');
      const rows = await db.getUserDanmaku(
        key,
        userDanmakuReadLimit(site.DanmakuEpisodeLimit),
      );
      rows.sort(
        (a, b) =>
          a.timeMs - b.timeMs ||
          a.createdAt - b.createdAt ||
          a.id.localeCompare(b.id),
      );
      return json({
        items: rows.map((row) => item(row, username)),
        limit: site.DanmakuEpisodeLimit,
      });
    }
    const input = await jsonBody(request);
    if (!isValidUserDanmakuKey(input.key))
      throw new InputError('弹幕集标识无效');
    const text = normalizeUserDanmakuText(input.text);
    if (text === null) throw new InputError('弹幕内容为空或过长');
    if (
      typeof input.time !== 'number' ||
      !Number.isFinite(input.time) ||
      input.time < 0 ||
      input.time > 86_400
    )
      throw new InputError('弹幕时间无效');
    const mode = normalizeUserDanmakuMode(input.mode);
    const color = normalizeUserDanmakuColor(input.color);
    if (input.mode !== mode) throw new InputError('弹幕模式无效');
    if (
      typeof input.color !== 'string' ||
      input.color.trim().toLowerCase() !== color
    )
      throw new InputError('弹幕颜色无效');
    await consumeSharedQuota(
      await sharedResourceStore(),
      resourceKey('user-danmaku-send', username),
      1,
      10,
      429,
    );
    const row: StoredUserDanmaku = {
      id: randomUUID(),
      episodeKey: input.key,
      username,
      timeMs: Math.round(input.time * 1000),
      text,
      mode,
      color,
      createdAt: Date.now(),
    };
    await db.addUserDanmaku(row);
    return json({ item: item(row, username) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleAdminUserDanmaku(request: NextRequest) {
  try {
    const guard = await requireAdmin(request, {
      unauthorizedMessage: '请先登录',
    });
    if (isGuardFailure(guard)) return guard.response;
    if (request.method === 'DELETE') {
      checkWriteOrigin(request);
      const { ids } = await jsonBody(request);
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > ADMIN_USER_DANMAKU_DELETE_LIMIT ||
        !ids.every(validId)
      )
        throw new InputError('弹幕标识列表无效');
      return json({
        deleted: await db.deleteUserDanmakuBatch([...new Set(ids)]),
      });
    }
    const params = request.nextUrl.searchParams;
    const q = (params.get('q') || '').trim();
    if (q.length > 200) throw new InputError('搜索内容过长');
    const rows = await db.getUserDanmakuPage({
      cursor: decodeCursor(params.get('cursor')),
      q,
    });
    const hasMore = rows.length > ADMIN_USER_DANMAKU_PAGE_SIZE;
    const page = rows.slice(0, ADMIN_USER_DANMAKU_PAGE_SIZE);
    const last = page[page.length - 1];
    return json({
      items: page.map(({ timeMs, ...row }) => ({
        ...row,
        time: timeMs / 1000,
      })),
      nextCursor: hasMore
        ? Buffer.from(
            JSON.stringify({ id: last.id, createdAt: last.createdAt }),
          ).toString('base64url')
        : null,
    });
  } catch (error) {
    return failure(error);
  }
}
