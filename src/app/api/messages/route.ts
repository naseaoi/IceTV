import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import {
  getUserMessagePage,
  getUserMessageSummary,
  normalizeMessageLimit,
  readAllUserMessages,
  readUserMessage,
} from '@/lib/messages.server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    const result =
      searchParams.get('view') === 'summary'
        ? await getUserMessageSummary(guardResult.username)
        : await getUserMessagePage(
            guardResult.username,
            normalizeMessageLimit(searchParams.get('limit')),
            searchParams.get('cursor'),
          );
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('获取用户消息失败', error);
    return NextResponse.json({ error: '获取消息失败' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;
    const body = (await request.json()) as {
      action?: 'read' | 'read-all';
      messageId?: string;
    };

    if (body.action === 'read-all') {
      return NextResponse.json(
        await readAllUserMessages(guardResult.username),
        { headers: NO_STORE_HEADERS },
      );
    }
    if (
      body.action !== 'read' ||
      typeof body.messageId !== 'string' ||
      body.messageId.length > 1024
    ) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    const result = await readUserMessage(guardResult.username, body.messageId);
    if (!result) {
      return NextResponse.json({ error: '消息不存在' }, { status: 404 });
    }
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('更新用户消息失败', error);
    return NextResponse.json({ error: '更新消息失败' }, { status: 500 });
  }
}
