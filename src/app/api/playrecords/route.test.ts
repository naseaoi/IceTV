/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import {
  savePlayProgressWithRetry,
  updatePlayRecordWithRetry,
} from '@/lib/play-record-write';
import type { PlayRecord } from '@/lib/types';

installWebPolyfills();

const mockGetLatestPlayRecordByTitle = jest.fn();
const mockGetAllPlayRecords = jest.fn();
const mockGetPlayRecordsByKeys = jest.fn();
const mockGetPlayRecord = jest.fn();
const mockGetPlayRecordPage = jest.fn();
const mockSavePlayRecord = jest.fn();
const mockCas = jest.fn();
const mockStore = {
  getPlayRecordSnapshot: async () => {
    const record = await mockGetPlayRecord();
    return record ? JSON.stringify(record) : null;
  },
  setPlayRecordIfUnchanged: (...args: unknown[]) => mockCas(...args),
  getLatestPlayRecordByTitle: (...args: unknown[]) =>
    mockGetLatestPlayRecordByTitle(...args),
};
const mockDeletePlayRecord = jest.fn();
const mockDeletePlayRecords = jest.fn();
const mockDeleteAllPlayRecords = jest.fn();

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest
    .fn()
    .mockResolvedValue({ username: 'demo', isOwner: false, role: 'user' }),
  isGuardFailure: (result: object) => 'response' in result,
}));

jest.mock('@/lib/db', () => ({
  db: {
    getLatestPlayRecordByTitle: (...args: unknown[]) =>
      mockGetLatestPlayRecordByTitle(...args),
    getAllPlayRecords: (...args: unknown[]) => mockGetAllPlayRecords(...args),
    getPlayRecordsByKeys: (...args: unknown[]) =>
      mockGetPlayRecordsByKeys(...args),
    getPlayRecord: (...args: unknown[]) => mockGetPlayRecord(...args),
    getPlayRecordPage: (...args: unknown[]) => mockGetPlayRecordPage(...args),
    savePlayProgress: (
      user: string,
      source: string,
      id: string,
      record: PlayRecord,
    ) => savePlayProgressWithRetry(mockStore, user, `${source}+${id}`, record),
    updatePlayRecord: (
      user: string,
      source: string,
      id: string,
      update: (current: PlayRecord | null) => PlayRecord | null,
    ) => updatePlayRecordWithRetry(mockStore, user, `${source}+${id}`, update),
    deletePlayRecord: (...args: unknown[]) => mockDeletePlayRecord(...args),
    deletePlayRecords: (...args: unknown[]) => mockDeletePlayRecords(...args),
    deleteAllPlayRecords: (...args: unknown[]) =>
      mockDeleteAllPlayRecords(...args),
  },
}));

const { GET, PATCH, POST, DELETE } =
  require('./route') as typeof import('./route');

function createRequest(url: string, init?: RequestInit): NextRequest {
  const request = new Request(url, init);
  if (typeof request.text !== 'function') {
    request.text = async () => String(init?.body ?? '');
  }
  return request as unknown as NextRequest;
}

function createJsonRequest(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

const records = {
  'source+old': {
    title: '旧记录',
    source_name: '源站',
    cover: '',
    year: '2020',
    index: 1,
    total_episodes: 1,
    play_time: 1,
    total_time: 10,
    save_time: 100,
  },
  'source+new': {
    title: '新记录',
    source_name: '源站',
    cover: '',
    year: '2024',
    index: 1,
    total_episodes: 1,
    play_time: 1,
    total_time: 10,
    save_time: 300,
  },
  'source+middle': {
    title: '中间记录',
    source_name: '源站',
    cover: '',
    year: '2022',
    index: 1,
    total_episodes: 1,
    play_time: 1,
    total_time: 10,
    save_time: 200,
  },
};

describe('playrecords route', () => {
  it.each([1, 2])('同会话迟到序号 %s 返回成功且不写入', async (sequence) => {
    mockGetPlayRecord.mockResolvedValue({
      ...records['source+new'],
      progress_session_id: 'session-a',
      progress_sequence: 2,
    });
    const response = await POST(
      createJsonRequest({
        key: 'source+new',
        record: {
          ...records['source+new'],
          progress_session_id: 'session-a',
          progress_sequence: sequence,
          save_time: 99999,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ignored: true });
    expect(mockCas).not.toHaveBeenCalled();
  });

  it('跨会话保存允许时钟与序号更小', async () => {
    mockGetPlayRecord.mockResolvedValue({
      ...records['source+new'],
      progress_session_id: 'session-a',
      progress_sequence: 100,
    });
    const response = await POST(
      createJsonRequest({
        key: 'source+new',
        record: {
          ...records['source+new'],
          progress_session_id: 'session-b',
          progress_sequence: 1,
          save_time: 1,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(mockSavePlayRecord).toHaveBeenCalledWith(
      'demo',
      'source',
      'new',
      expect.objectContaining({
        save_time: 1,
        progress_session_id: 'session-b',
      }),
    );
  });

  it('并发 CAS 冲突后重读，较新请求胜出时旧请求停止写入', async () => {
    mockGetPlayRecord.mockResolvedValueOnce(null).mockResolvedValue({
      ...records['source+new'],
      progress_session_id: 'session-a',
      progress_sequence: 3,
    });
    mockCas.mockResolvedValueOnce(false);
    const response = await POST(
      createJsonRequest({
        key: 'source+new',
        record: {
          ...records['source+new'],
          progress_session_id: 'session-a',
          progress_sequence: 2,
        },
      }),
    );
    expect(await response.json()).toEqual({ success: true, ignored: true });
    expect(mockGetPlayRecord).toHaveBeenCalledTimes(2);
    expect(mockCas).toHaveBeenCalledTimes(1);
  });

  it('持续并发冲突最多尝试八次', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCas.mockResolvedValue(false);
    try {
      const response = await POST(
        createJsonRequest({ key: 'source+new', record: records['source+new'] }),
      );
      expect(response.status).toBe(409);
      expect(mockCas).toHaveBeenCalledTimes(8);
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    { progress_session_id: 'session' },
    { progress_sequence: 1 },
    { progress_session_id: '', progress_sequence: 1 },
    { progress_session_id: 'x'.repeat(129), progress_sequence: 1 },
    { progress_session_id: 'session', progress_sequence: 0 },
    { progress_session_id: 'session', progress_sequence: -1 },
    { progress_session_id: 'session', progress_sequence: 1.5 },
    {
      progress_session_id: 'session',
      progress_sequence: Number.MAX_SAFE_INTEGER + 1,
    },
    { progress_session_id: null, progress_sequence: 1 },
    { progress_session_id: 'session', progress_sequence: '2' },
  ])('拒绝无效序号字段 %p', async (ordering) => {
    const response = await POST(
      createJsonRequest({
        key: 'source+new',
        record: { ...records['source+new'], ...ordering },
      }),
    );
    expect(response.status).toBe(400);
    expect(mockCas).not.toHaveBeenCalled();
  });

  it.each(['set-tracking', 'mark-update-read'])(
    '元数据操作 %s 保留最新进度及序号',
    async (action) => {
      mockGetPlayRecord
        .mockResolvedValueOnce(records['source+new'])
        .mockResolvedValue({
          ...records['source+new'],
          progress_session_id: 'session-a',
          progress_sequence: 5,
          play_time: 500,
        });
      mockCas.mockResolvedValueOnce(false);
      const response = await PATCH(
        createJsonRequest({
          key: 'source+new',
          action,
          trackingEnabled: false,
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        progress_session_id: 'session-a',
        progress_sequence: 5,
        play_time: 500,
      });
      expect(mockCas).toHaveBeenCalledTimes(2);
    },
  );

  it('标题查询使用当前登录用户并禁止缓存', async () => {
    mockGetLatestPlayRecordByTitle.mockResolvedValue({
      'source+new': records['source+new'],
    });
    const response = await GET(
      createRequest('http://localhost/api/playrecords?title=新记录&year=2024'),
    );
    expect(mockGetLatestPlayRecordByTitle).toHaveBeenCalledWith(
      'demo',
      '新记录',
      '2024',
    );
    expect(await response.json()).toEqual({
      'source+new': records['source+new'],
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('拒绝空标题', async () => {
    const response = await GET(
      createRequest('http://localhost/api/playrecords?title='),
    );
    expect(response.status).toBe(400);
  });
  it.each(['ongoing', 'ended'])(
    '保存合法作品状态 %s 并保留手动追更',
    async (series_status) => {
      mockGetPlayRecord.mockResolvedValue({
        ...records['source+new'],
        tracking_enabled: true,
      });
      const response = await POST(
        createJsonRequest({
          key: 'source+new',
          record: { ...records['source+new'], series_status },
        }),
      );
      expect(response.status).toBe(200);
      expect(mockSavePlayRecord).toHaveBeenCalledWith(
        'demo',
        'source',
        'new',
        expect.objectContaining({ series_status, tracking_enabled: true }),
      );
    },
  );

  it.each(['unknown', '', null, true, 1, {}, []])(
    '拒绝非法作品状态 %p',
    async (series_status) => {
      const response = await POST(
        createJsonRequest({
          key: 'source+new',
          record: { ...records['source+new'], series_status },
        }),
      );
      expect(response.status).toBe(400);
      expect(mockSavePlayRecord).not.toHaveBeenCalled();
    },
  );

  it('拒绝非布尔追更开关', async () => {
    const response = await POST(
      createJsonRequest({
        key: 'source+new',
        record: { ...records['source+new'], tracking_enabled: 'false' },
      }),
    );
    expect(response.status).toBe(400);
    expect(mockSavePlayRecord).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllPlayRecords.mockResolvedValue(records);
    mockGetPlayRecord.mockResolvedValue(null);
    mockGetLatestPlayRecordByTitle.mockResolvedValue({});
    mockGetPlayRecordPage.mockResolvedValue({
      items: {
        'source+new': records['source+new'],
        'source+middle': records['source+middle'],
      },
      total: 3,
      nextCursor: '200|source+middle',
    });
    mockSavePlayRecord.mockResolvedValue(undefined);
    mockCas.mockImplementation(async (user, key, record) => {
      const [source, id] = key.split('+');
      await mockSavePlayRecord(user, source, id, record);
      return true;
    });
  });

  it('按候选键去重读取且仅查询当前账号，缺失键省略', async () => {
    mockGetPlayRecordsByKeys.mockResolvedValue({
      'source+new': records['source+new'],
    });
    const response = await GET(
      createRequest(
        'http://localhost/api/playrecords?keys=source%2Bnew&keys=source%2Bmissing&keys=source%2Bnew',
      ),
    );
    expect(await response.json()).toEqual({
      'source+new': records['source+new'],
    });
    expect(mockGetPlayRecordsByKeys.mock.calls).toEqual([
      ['demo', ['source+new', 'source+missing']],
    ]);
    expect(mockGetPlayRecord).not.toHaveBeenCalled();
    expect(mockGetAllPlayRecords).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it.each([
    'keys=',
    'keys=invalid',
    'keys=%2Bid',
    'keys=source%2B',
    `keys=s%2B${'x'.repeat(512)}`,
    Array.from({ length: 51 }, (_, i) => `keys=s%2B${i}`).join('&'),
  ])('拒绝无效或超限定向参数 %s', async (query) => {
    const response = await GET(
      createRequest(`http://localhost/api/playrecords?${query}`),
    );
    expect(response.status).toBe(400);
    expect(mockGetPlayRecordsByKeys).not.toHaveBeenCalled();
    expect(mockGetPlayRecord).not.toHaveBeenCalled();
    expect(mockGetAllPlayRecords).not.toHaveBeenCalled();
  });

  it('接受上限 50 个键并保留 id 内的加号', async () => {
    const params = new URLSearchParams();
    Array.from({ length: 50 }, (_, i) => params.append('keys', `s+${i}+part`));
    const response = await GET(
      createRequest(`http://localhost/api/playrecords?${params}`),
    );
    expect(response.status).toBe(200);
    expect(mockGetPlayRecordsByKeys).toHaveBeenCalledTimes(1);
    expect(mockGetPlayRecordsByKeys).toHaveBeenCalledWith(
      'demo',
      params.getAll('keys'),
    );
    expect(mockGetPlayRecord).not.toHaveBeenCalled();
  });

  it('limit 参数只返回按保存时间排序的最近记录', async () => {
    const response = await GET(
      createRequest('http://localhost/api/playrecords?limit=2'),
    );

    await expect(response.json()).resolves.toEqual({
      'source+new': records['source+new'],
      'source+middle': records['source+middle'],
    });
    expect(response.status).toBe(200);
    expect(mockGetPlayRecordPage).toHaveBeenCalledWith('demo', 2);
    expect(mockGetAllPlayRecords).not.toHaveBeenCalled();
  });

  it('不带 limit 时保持返回完整记录', async () => {
    const response = await GET(
      createRequest('http://localhost/api/playrecords'),
    );

    await expect(response.json()).resolves.toEqual(records);
  });

  it('分页格式返回总数和下一页游标', async () => {
    const response = await GET(
      createRequest('http://localhost/api/playrecords?format=page&limit=2'),
    );

    await expect(response.json()).resolves.toEqual({
      items: {
        'source+new': records['source+new'],
        'source+middle': records['source+middle'],
      },
      total: 3,
      nextCursor: '200|source+middle',
    });
    expect(mockGetPlayRecordPage).toHaveBeenCalledWith(
      'demo',
      2,
      undefined,
      undefined,
      undefined,
    );
    expect(mockGetAllPlayRecords).not.toHaveBeenCalled();
  });

  it.each(['updated', 'shelved', 'unknown'])(
    '分页传递筛选 %s 并保留游标',
    async (filter) => {
      const response = await GET(
        createRequest(
          `http://localhost/api/playrecords?format=page&limit=2&cursor=200%7Csource%2Bmiddle&filter=${filter}`,
        ),
      );
      expect(response.status).toBe(200);
      expect(mockGetPlayRecordPage).toHaveBeenCalledWith(
        'demo',
        2,
        200,
        'source+middle',
        filter === 'updated' || filter === 'shelved' ? filter : undefined,
      );
      expect(await response.json()).toEqual(
        await mockGetPlayRecordPage.mock.results[0].value,
      );
    },
  );

  it('批量删除合法键并去重', async () => {
    const response = await DELETE(
      createRequest('http://localhost/api/playrecords', {
        method: 'DELETE',
        body: JSON.stringify({ keys: ['source+a', 'source+b', 'source+a'] }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockDeletePlayRecords).toHaveBeenCalledWith('demo', [
      'source+a',
      'source+b',
    ]);
    expect(mockDeleteAllPlayRecords).not.toHaveBeenCalled();
  });

  it.each([
    { keys: ['source+a', 'invalid'] },
    { keys: ['+a'] },
    { keys: ['source+'] },
    { keys: [1] },
    { keys: 'source+a' },
    {},
    null,
    { keys: Array.from({ length: 201 }, (_, index) => `source+${index}`) },
  ])('拒绝非法批量删除参数 %p', async (body) => {
    const response = await DELETE(
      createRequest('http://localhost/api/playrecords', {
        method: 'DELETE',
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(400);
    expect(mockDeletePlayRecords).not.toHaveBeenCalled();
    expect(mockDeleteAllPlayRecords).not.toHaveBeenCalled();
  });

  it('空数组为空操作，单条删除及无请求体清空保留', async () => {
    const response = await DELETE(
      createRequest('http://localhost/api/playrecords', {
        method: 'DELETE',
        body: JSON.stringify({ keys: [] }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mockDeletePlayRecords).not.toHaveBeenCalled();
    expect(mockDeleteAllPlayRecords).not.toHaveBeenCalled();
    await DELETE(
      createRequest('http://localhost/api/playrecords?key=source%2Ba', {
        method: 'DELETE',
      }),
    );
    expect(mockDeletePlayRecord).toHaveBeenCalledWith('demo', 'source', 'a');
    await DELETE(
      createRequest('http://localhost/api/playrecords', { method: 'DELETE' }),
    );
    expect(mockDeleteAllPlayRecords).toHaveBeenCalledWith('demo');
  });

  it('非法 JSON 返回 400 并保留记录', async () => {
    const response = await DELETE(
      createRequest('http://localhost/api/playrecords', {
        method: 'DELETE',
        body: '{',
      }),
    );
    expect(response.status).toBe(400);
    expect(mockDeleteAllPlayRecords).not.toHaveBeenCalled();
  });

  it('换源首次保存沿用同作品其他源的已知集数', async () => {
    const oldSource: PlayRecord = {
      ...records['source+new'],
      index: 4,
      total_episodes: 6,
      update_baseline_episodes: 6,
      tracking_enabled: true,
    };
    mockGetLatestPlayRecordByTitle.mockResolvedValue({ 'old+1': oldSource });
    const save = async (record: PlayRecord) => {
      mockSavePlayRecord.mockClear();
      await POST(createJsonRequest({ key: 'source+new', record }));
      return mockSavePlayRecord.mock.calls[0][3] as PlayRecord;
    };
    const next = {
      ...records['source+new'],
      index: 4,
      total_episodes: 7,
      update_baseline_episodes: 7,
    };

    expect(await save(next)).toMatchObject({
      update_baseline_episodes: 6,
      tracking_enabled: true,
      update_detected_at: expect.any(Number),
    });
    expect(
      await save({ ...next, total_episodes: 5, update_baseline_episodes: 5 }),
    ).toMatchObject({ update_baseline_episodes: 5 });

    mockGetLatestPlayRecordByTitle.mockResolvedValue({
      'old+1': { ...oldSource, year: '2020' },
    });
    expect(await save(next)).toMatchObject({ update_baseline_episodes: 7 });

    mockGetLatestPlayRecordByTitle.mockResolvedValue({
      'old+1': {
        ...oldSource,
        group_index: 4,
        group_total: 6,
        group_label: '第一季',
      },
    });
    expect(
      await save({
        ...next,
        group_index: 4,
        group_total: 7,
        group_label: '第二季',
      }),
    ).toMatchObject({ update_baseline_group_total: 7 });
  });

  it('保存播放进度不推进元数据检查时间', async () => {
    mockGetPlayRecord.mockResolvedValue({
      ...records['source+new'],
      metadata_checked_at: 1234,
    });

    const response = await POST(
      createJsonRequest({
        key: 'source+new',
        record: { ...records['source+new'], metadata_checked_at: 9999 },
      }),
    );

    expect(response.status).toBe(200);
    expect(mockSavePlayRecord).toHaveBeenCalledWith(
      'demo',
      'source',
      'new',
      expect.objectContaining({ metadata_checked_at: 1234 }),
    );
  });

  it('把当前可用集数标记为已读', async () => {
    mockGetPlayRecord.mockResolvedValue({
      ...records['source+new'],
      index: 2,
      total_episodes: 4,
      update_baseline_episodes: 3,
    });

    const response = await PATCH(
      createJsonRequest({ key: 'source+new', action: 'mark-update-read' }),
    );

    expect(response.status).toBe(200);
    expect(mockSavePlayRecord).toHaveBeenCalledWith(
      'demo',
      'source',
      'new',
      expect.objectContaining({ update_baseline_episodes: 4 }),
    );
  });

  it('可以关闭和重新开启追更', async () => {
    mockGetPlayRecord.mockResolvedValue(records['source+new']);

    const response = await PATCH(
      createJsonRequest({
        key: 'source+new',
        action: 'set-tracking',
        trackingEnabled: false,
      }),
    );

    expect(response.status).toBe(200);
    expect(mockSavePlayRecord).toHaveBeenCalledWith(
      'demo',
      'source',
      'new',
      expect.objectContaining({ tracking_enabled: false }),
    );
  });

  it('拒绝无效的播放记录状态操作', async () => {
    mockGetPlayRecord.mockResolvedValue(records['source+new']);
    const response = await PATCH(
      createJsonRequest({ key: 'source+new', action: 'unknown' }),
    );
    expect(response.status).toBe(400);
    expect(mockSavePlayRecord).not.toHaveBeenCalled();
  });
});
