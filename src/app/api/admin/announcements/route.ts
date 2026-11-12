import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { ANNOUNCEMENT_MAX_LENGTH } from '@/lib/announcement-identity';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';

export const runtime = 'nodejs';

const ADMIN_LIST_LIMIT = 200;

type AnnouncementBody = {
  id?: unknown;
  content?: unknown;
  publish?: unknown;
  action?: unknown;
};

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function readContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const content = value.trim();
  return content && content.length <= ANNOUNCEMENT_MAX_LENGTH ? content : null;
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value && value.length <= 64
    ? value
    : null;
}

async function readBody(request: NextRequest): Promise<AnnouncementBody> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' ? (body as AnnouncementBody) : {};
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  try {
    const guard = await requireAdmin(request);
    if (isGuardFailure(guard)) return guard.response;
    return NextResponse.json(
      { items: await db.listAnnouncements(ADMIN_LIST_LIMIT) },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('获取公告失败:', error);
    return NextResponse.json({ error: '获取公告失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requireAdmin(request);
    if (isGuardFailure(guard)) return guard.response;
    const body = await readBody(request);
    const content = readContent(body.content);
    if (!content)
      return badRequest(
        `公告内容不能为空且不超过 ${ANNOUNCEMENT_MAX_LENGTH} 字`,
      );
    const now = Date.now();
    const announcement = {
      id: randomUUID(),
      content,
      createdAt: now,
      updatedAt: now,
      publishedAt: body.publish === true ? now : null,
    };
    await db.createAnnouncement(announcement);
    return NextResponse.json(
      { announcement },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error('创建公告失败:', error);
    return NextResponse.json({ error: '创建公告失败' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireAdmin(request);
    if (isGuardFailure(guard)) return guard.response;
    const body = await readBody(request);
    const id = readId(body.id);
    if (!id) return badRequest('参数格式错误');
    const now = Date.now();
    let patch: { content?: string; publishedAt?: number | null };
    if (body.action === 'publish') patch = { publishedAt: now };
    else if (body.action === 'withdraw') patch = { publishedAt: null };
    else if (body.action === undefined) {
      const content = readContent(body.content);
      if (!content)
        return badRequest(
          `公告内容不能为空且不超过 ${ANNOUNCEMENT_MAX_LENGTH} 字`,
        );
      patch = { content };
    } else return badRequest('参数格式错误');

    // 推送只作用于草稿，重复点击不会刷新推送时间而再次打扰用户
    if (body.action === 'publish') {
      const current = await db.getAnnouncement(id);
      if (!current)
        return NextResponse.json({ error: '公告不存在' }, { status: 404 });
      if (current.publishedAt !== null)
        return NextResponse.json(
          { announcement: current },
          { headers: NO_STORE_HEADERS },
        );
    }
    const announcement = await db.updateAnnouncement(id, {
      ...patch,
      updatedAt: now,
    });
    if (!announcement)
      return NextResponse.json({ error: '公告不存在' }, { status: 404 });
    return NextResponse.json({ announcement }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('更新公告失败:', error);
    return NextResponse.json({ error: '更新公告失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const guard = await requireAdmin(request);
    if (isGuardFailure(guard)) return guard.response;
    const id = readId((await readBody(request)).id);
    if (!id) return badRequest('参数格式错误');
    if (!(await db.deleteAnnouncement(id)))
      return NextResponse.json({ error: '公告不存在' }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('删除公告失败:', error);
    return NextResponse.json({ error: '删除公告失败' }, { status: 500 });
  }
}
