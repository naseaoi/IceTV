import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import { PlayRecordConflictError } from '@/lib/play-record-write';
import {
  markPlayRecordUpdateRead,
  MAX_DELETE_PLAY_RECORD_KEYS,
  MAX_PLAY_RECORD_KEY_LENGTH,
  MAX_READ_PLAY_RECORD_KEYS,
  normalizePlayRecordLimit,
  parsePlayRecordCursor,
} from '@/lib/play-records';
import { isSeriesStatus } from '@/lib/series-status';
import { PlayRecord } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    if (searchParams.has('title')) {
      const title = (searchParams.get('title') || '').trim();
      const year = (searchParams.get('year') || '').trim();
      if (!title || title.length > 300 || year.length > 16) {
        return NextResponse.json({ error: '无效的作品信息' }, { status: 400 });
      }
      const records = await db.getLatestPlayRecordByTitle(
        guardResult.username,
        title,
        year,
      );
      return NextResponse.json(records, { headers: NO_STORE_HEADERS });
    }
    if (searchParams.has('keys')) {
      const keys = searchParams.getAll('keys');
      if (
        keys.length > MAX_READ_PLAY_RECORD_KEYS ||
        keys.some(
          (key) =>
            key.length > MAX_PLAY_RECORD_KEY_LENGTH || !parseStorageKey(key),
        )
      ) {
        return NextResponse.json(
          { error: '无效的播放记录键或查询数量超限' },
          { status: 400 },
        );
      }
      const records = await db.getPlayRecordsByKeys(guardResult.username, [
        ...new Set(keys),
      ]);
      return NextResponse.json(records, { headers: NO_STORE_HEADERS });
    }
    if (searchParams.get('format') === 'page') {
      const cursor = parsePlayRecordCursor(searchParams.get('cursor'));
      const page = await db.getPlayRecordPage(
        guardResult.username,
        normalizePlayRecordLimit(searchParams.get('limit')),
        cursor?.time,
        cursor?.key,
        searchParams.get('filter') === 'shelved'
          ? 'shelved'
          : searchParams.get('filter') === 'updated'
            ? 'updated'
            : undefined,
      );
      return NextResponse.json(page, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    }
    const limitParam = searchParams.get('limit');
    const responseRecords =
      limitParam === null
        ? await db.getAllPlayRecords(guardResult.username)
        : (
            await db.getPlayRecordPage(
              guardResult.username,
              normalizePlayRecordLimit(limitParam),
            )
          ).items;
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
    if (
      !record.title ||
      !record.source_name ||
      record.index < 1 ||
      (record.series_status !== undefined &&
        !isSeriesStatus(record.series_status)) ||
      (record.tracking_enabled !== undefined &&
        typeof record.tracking_enabled !== 'boolean')
    ) {
      return NextResponse.json(
        { error: 'Invalid record data' },
        { status: 400 },
      );
    }

    if (
      (record.progress_session_id !== undefined ||
        record.progress_sequence !== undefined) &&
      (typeof record.progress_session_id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(record.progress_session_id) ||
        !Number.isSafeInteger(record.progress_sequence) ||
        record.progress_sequence! < 1)
    ) {
      return NextResponse.json(
        { error: 'Invalid progress ordering' },
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

    const saved = await db.savePlayProgress(
      guardResult.username,
      parsed.source,
      parsed.id,
      { ...record, save_time: record.save_time ?? Date.now() },
    );
    if (!saved) return NextResponse.json({ success: true, ignored: true });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof PlayRecordConflictError) {
      return NextResponse.json(
        { error: '播放进度保存繁忙，请稍后重试' },
        { status: 409 },
      );
    }
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

    if (
      body.action !== 'mark-update-read' &&
      !(
        body.action === 'set-tracking' &&
        typeof body.trackingEnabled === 'boolean'
      )
    ) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    const nextRecord = await db.updatePlayRecord(
      guardResult.username,
      parsed.source,
      parsed.id,
      (current) => {
        if (!current) return null;
        return body.action === 'mark-update-read'
          ? markPlayRecordUpdateRead(current, body.readThroughEpisodes)
          : { ...current, tracking_enabled: body.trackingEnabled };
      },
    );
    if (!nextRecord) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
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
      const text = await request.text();
      if (text.trim()) {
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return NextResponse.json(
            { error: 'Invalid JSON body' },
            { status: 400 },
          );
        }
        const keys =
          body && typeof body === 'object' && 'keys' in body
            ? body.keys
            : undefined;
        if (!Array.isArray(keys) || keys.length > MAX_DELETE_PLAY_RECORD_KEYS) {
          return NextResponse.json(
            { error: 'keys must be an array of at most 200 items' },
            { status: 400 },
          );
        }
        if (
          keys.some((key) => typeof key !== 'string' || !parseStorageKey(key))
        ) {
          return NextResponse.json(
            { error: 'Invalid key format' },
            { status: 400 },
          );
        }
        if (keys.length > 0)
          await db.deletePlayRecords(username, [...new Set(keys)]);
      } else {
        await db.deleteAllPlayRecords(username);
      }
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
