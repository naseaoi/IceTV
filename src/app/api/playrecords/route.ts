import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import {
  normalizePlayRecordLimit,
  selectRecentPlayRecords,
} from '@/lib/play-records';
import { PlayRecord } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const records = await db.getAllPlayRecords(guardResult.username);
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const responseRecords =
      limitParam === null
        ? records
        : selectRecentPlayRecords(
            records,
            normalizePlayRecordLimit(limitParam),
          );
    return NextResponse.json(responseRecords, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err) {
    console.error('获取播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = await request.json();
    const { key, record }: { key: string; record: PlayRecord } = body;

    if (!key || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 },
      );
    }

    // 验证播放记录数据
    if (!record.title || !record.source_name || record.index < 1) {
      return NextResponse.json(
        { error: 'Invalid record data' },
        { status: 400 },
      );
    }

    // 从key中解析source和id
    const parsed = parseStorageKey(key);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 },
      );
    }

    const now = Date.now();
    const finalRecord = {
      ...record,
      save_time: record.save_time ?? now,
      metadata_checked_at: now,
    } as PlayRecord;

    await db.savePlayRecord(
      guardResult.username,
      parsed.source,
      parsed.id,
      finalRecord,
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('保存播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const username = guardResult.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 如果提供了 key，删除单条播放记录
      const parsed = parseStorageKey(key);
      if (!parsed) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 },
        );
      }

      await db.deletePlayRecord(username, parsed.source, parsed.id);
    } else {
      await db.deleteAllPlayRecords(username);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
