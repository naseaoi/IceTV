/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockGetAllPlayRecords = jest.fn();
const mockGetPlayRecord = jest.fn();
const mockGetPlayRecordPage = jest.fn();
const mockSavePlayRecord = jest.fn();
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
    getAllPlayRecords: (...args: unknown[]) => mockGetAllPlayRecords(...args),
    getPlayRecord: (...args: unknown[]) => mockGetPlayRecord(...args),
    getPlayRecordPage: (...args: unknown[]) => mockGetPlayRecordPage(...args),
    savePlayRecord: (...args: unknown[]) => mockSavePlayRecord(...args),
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
    mockGetPlayRecordPage.mockResolvedValue({
      items: {
        'source+new': records['source+new'],
        'source+middle': records['source+middle'],
      },
      total: 3,
      nextCursor: '200|source+middle',
    });
    mockSavePlayRecord.mockResolvedValue(undefined);
  });

  it('按候选键去重读取且仅查询当前账号，缺失键省略', async () => {
    mockGetPlayRecord.mockImplementation(async (_user, _source, id) =>
      id === 'new' ? records['source+new'] : null,
    );
    const response = await GET(
      createRequest(
        'http://localhost/api/playrecords?keys=source%2Bnew&keys=source%2Bmissing&keys=source%2Bnew',
      ),
    );
    expect(await response.json()).toEqual({
      'source+new': records['source+new'],
    });
    expect(mockGetPlayRecord.mock.calls).toEqual([
      ['demo', 'source', 'new'],
      ['demo', 'source', 'missing'],
    ]);
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
    expect(mockGetPlayRecord).toHaveBeenCalledTimes(50);
    expect(mockGetPlayRecord).toHaveBeenCalledWith('demo', 's', '0+part');
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

  it('保存播放进度时由服务端记录元数据检查时间', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234);

    try {
      const response = await POST(
        createJsonRequest({
          key: 'source+new',
          record: records['source+new'],
        }),
      );

      expect(response.status).toBe(200);
      expect(mockSavePlayRecord).toHaveBeenCalledWith(
        'demo',
        'source',
        'new',
        expect.objectContaining({ metadata_checked_at: 1234 }),
      );
    } finally {
      nowSpy.mockRestore();
    }
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
