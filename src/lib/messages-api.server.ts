import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import {
  dateFormatter,
  PlaybackPeriodValidationError,
} from '@/features/playback-stats/lib/period';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { normalizeMessageLimit } from '@/lib/message-page';
import {
  getAnnouncementHistory,
  getUserMessagePage,
  getUserMessageSummary,
  readAllUserMessages,
  readUserMessage,
} from '@/lib/messages.server';
import { ReviewValidationError } from '@/lib/video-reviews';

export async function handleGetMessages(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    const timeZone = searchParams.get('tz') ?? 'UTC';
    dateFormatter(timeZone);
    const result =
      searchParams.get('view') === 'summary'
        ? await getUserMessageSummary(guardResult.username, timeZone)
        : await getUserMessagePage(
            guardResult.username,
            normalizeMessageLimit(searchParams.get('limit')),
            searchParams.get('cursor'),
            timeZone,
          );
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (
      error instanceof ReviewValidationError ||
      error instanceof PlaybackPeriodValidationError
    )
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    console.error('获取用户消息失败', error);
    return NextResponse.json({ error: '获取消息失败' }, { status: 500 });
  }
}

export async function handleGetAnnouncementHistory(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;
    const cursor = new URL(request.url).searchParams.get('cursor');
    return NextResponse.json(await getAnnouncementHistory(cursor), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (
      error instanceof ReviewValidationError ||
      error instanceof PlaybackPeriodValidationError
    )
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    console.error('获取公告失败', error);
    return NextResponse.json({ error: '获取公告失败' }, { status: 500 });
  }
}

export async function handlePatchMessages(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;
    const timeZone = new URL(request.url).searchParams.get('tz') ?? 'UTC';
    dateFormatter(timeZone);
    const body = (await request.json()) as {
      action?: 'read' | 'read-all';
      messageId?: string;
    };

    if (body.action === 'read-all') {
      return NextResponse.json(
        await readAllUserMessages(guardResult.username, timeZone),
        { headers: NO_STORE_HEADERS },
      );
    }
    if (
      body.action !== 'read' ||
      typeof body.messageId !== 'string' ||
      body.messageId.length > 4000
    ) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    const result = await readUserMessage(
      guardResult.username,
      body.messageId,
      timeZone,
    );
    if (!result) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 });
    }
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof PlaybackPeriodValidationError)
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    console.error('更新用户消息失败', error);
    return NextResponse.json({ error: '更新消息失败' }, { status: 500 });
  }
}
