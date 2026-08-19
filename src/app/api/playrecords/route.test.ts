/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockGetAllPlayRecords = jest.fn();
const mockGetPlayRecord = jest.fn();
const mockGetPlayRecordPage = jest.fn();
const mockSavePlayRecord = jest.fn();

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
  },
}));

const { GET, PATCH, POST } = require('./route') as typeof import('./route');

function createRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
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

  it('limit 参数只返回按保存时间排序的最近记录', async () => {
    const response = await GET(
      createRequest('http://localhost/api/playrecords?limit=2'),
    );

    await expect(response.json()).resolves.toEqual({
      'source+new': records['source+new'],
      'source+middle': records['source+middle'],
    });
    expect(response.status).toBe(200);
    expect(mockGetAllPlayRecords).toHaveBeenCalledWith('demo');
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
    );
    expect(mockGetAllPlayRecords).not.toHaveBeenCalled();
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
