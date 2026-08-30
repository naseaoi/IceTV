import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import {
  markPlayRecordUpdateRead,
  mergePlayRecordUpdateBaseline,
  normalizePlayRecordLimit,
  parsePlayRecordCursor,
  selectRecentPlayRecords,
} from '@/lib/play-records';
import { PlayRecord } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    if (searchParams.get('format') === 'page') {
      const cursor = parsePlayRecordCursor(searchParams.get('cursor'));
      const page = await db.getPlayRecordPage(
        guardResult.username,
        normalizePlayRecordLimit(searchParams.get('limit')),
        cursor?.time,
        cursor?.key,
      );
      return NextResponse.json(page, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    }
    const records = await db.getAllPlayRecords(guardResult.username);
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
    const existingRecord = await db.getPlayRecord(
      guardResult.username,
      parsed.source,
      parsed.id,
    );
    const finalRecord = mergePlayRecordUpdateBaseline(existingRecord, {
      ...record,
      save_time: record.save_time ?? now,
      metadata_checked_at: now,
    } as PlayRecord);

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

export async function PATCH(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = (await request.json()) as {
      key?: string;
      action?: 'mark-update-read' | 'set-tracking';
      trackingEnabled?: boolean;
      readThroughEpisodes?: number;
    };
    const parsed = body.key ? parseStorageKey(body.key) : null;
    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 },
      );
    }

    const existingRecord = await db.getPlayRecord(
      guardResult.username,
      parsed.source,
      parsed.id,
    );
    if (!existingRecord) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    let nextRecord: PlayRecord;
    if (body.action === 'mark-update-read') {
      nextRecord = markPlayRecordUpdateRead(
        existingRecord,
        body.readThroughEpisodes,
      );
    } else if (
      body.action === 'set-tracking' &&
      typeof body.trackingEnabled === 'boolean'
    ) {
      nextRecord = {
        ...existingRecord,
        tracking_enabled: body.trackingEnabled,
      };
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    await db.savePlayRecord(
      guardResult.username,
      parsed.source,
      parsed.id,
      nextRecord,
    );
    return NextResponse.json(nextRecord, {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (err) {
    console.error('更新播放记录状态失败', err);
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
