import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

import { validateCapsuleInput, ViewingHappinessError } from './storage';

type Context = { params: Promise<{ id: string }> };

async function handle(
  request: NextRequest,
  operation: (username: string) => Promise<unknown>,
) {
  try {
    const guard = await requireActiveUser(request);
    if (isGuardFailure(guard)) return guard.response;
    return NextResponse.json(await operation(guard.username), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error instanceof ViewingHappinessError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: NO_STORE_HEADERS },
      );
    console.error('观影记录操作失败', error);
    return NextResponse.json(
      { error: '操作失败，请稍后重试' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
async function body(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ViewingHappinessError('请求体必须为有效 JSON');
  }
}
function completionKey(input: unknown): string {
  if (!input || typeof input !== 'object')
    throw new ViewingHappinessError('播放记录参数不正确');
  const { source, id } = input as Record<string, unknown>;
  if (
    typeof source !== 'string' ||
    !source.trim() ||
    source.length > 191 ||
    source.includes('+') ||
    typeof id !== 'string' ||
    !id.trim() ||
    id.length > 300
  )
    throw new ViewingHappinessError('播放记录参数不正确');
  return `${source}+${id}`;
}
async function requireCompletion(
  username: string,
  key: string,
  celebrate = false,
) {
  const result = await db.getCompletion(username, key, celebrate);
  if (!result) throw new ViewingHappinessError('播放记录不存在', 404);
  return result;
}
export function getCompletion(request: NextRequest) {
  return handle(request, (username) =>
    requireCompletion(
      username,
      completionKey(Object.fromEntries(new URL(request.url).searchParams)),
    ),
  );
}
export function celebrateCompletion(request: NextRequest) {
  return handle(request, async (username) => {
    await requireCompletion(username, completionKey(await body(request)), true);
    return { ok: true };
  });
}
export function getCapsules(request: NextRequest) {
  return handle(request, (username) =>
    db.getCapsules(username, new URL(request.url).searchParams.get('cursor')),
  );
}
export function createCapsule(request: NextRequest) {
  return handle(request, async (username) => {
    const input = await body(request);
    const now = Date.now();
    return db.createCapsule(username, validateCapsuleInput(input, now), now);
  });
}
export function deleteCapsule(request: NextRequest, context: Context) {
  return handle(request, async (username) => {
    if (!(await db.deleteCapsule(username, (await context.params).id)))
      throw new ViewingHappinessError('观后信不存在', 404);
    return { ok: true };
  });
}
export function openCapsule(request: NextRequest, context: Context) {
  return handle(request, async (username) => {
    const capsule = await db.openCapsule(username, (await context.params).id);
    if (!capsule)
      throw new ViewingHappinessError('观后信尚未送达或不存在', 404);
    return capsule;
  });
}
