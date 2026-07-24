/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

installWebPolyfills();

const mockGetAllPlayRecords = jest.fn();
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
    savePlayRecord: (...args: unknown[]) => mockSavePlayRecord(...args),
  },
}));

const { GET, POST } = require('./route') as typeof import('./route');

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
});
