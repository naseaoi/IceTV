import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const scopeKey = searchParams.get('scopeKey');

  if (!scopeKey || typeof scopeKey !== 'string') {
    return NextResponse.json({ error: 'scopeKey 参数必填' }, { status: 400 });
  }

  const episodeId = await db.getDanmakuEpisodeId(
    guardResult.username,
    scopeKey,
  );

  return NextResponse.json({ episodeId });
}

export async function PUT(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '无效的 JSON' }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('scopeKey' in body) ||
    !('episodeId' in body)
  ) {
    return NextResponse.json(
      { error: 'scopeKey 和 episodeId 必填' },
      { status: 400 },
    );
  }

  const { scopeKey, episodeId } = body as {
    scopeKey: unknown;
    episodeId: unknown;
  };

  if (typeof scopeKey !== 'string' || scopeKey.length === 0) {
    return NextResponse.json(
      { error: 'scopeKey 必须是非空字符串' },
      { status: 400 },
    );
  }

  if (typeof episodeId !== 'number' || !Number.isInteger(episodeId)) {
    return NextResponse.json(
      { error: 'episodeId 必须是整数' },
      { status: 400 },
    );
  }

  await db.setDanmakuEpisodeId(guardResult.username, scopeKey, episodeId);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const guardResult = await requireActiveUser(request);
  if (isGuardFailure(guardResult)) return guardResult.response;

  const { searchParams } = new URL(request.url);
  const scopeKey = searchParams.get('scopeKey');

  if (!scopeKey || typeof scopeKey !== 'string') {
    return NextResponse.json({ error: 'scopeKey 参数必填' }, { status: 400 });
  }

  await db.deleteDanmakuEpisodeId(guardResult.username, scopeKey);

  return NextResponse.json({ success: true });
}
