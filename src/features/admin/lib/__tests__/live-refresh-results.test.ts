import { refreshLiveChannelSources } from '@/features/live/lib/live';
import { fetchWithUrlGuard } from '@/lib/url-guard';

jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: { setLiveSourceChannelCount: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: jest.fn(),
  UrlValidationError: class extends Error {},
}));
jest.mock('@/lib/http-proxy-json', () => ({
  getProxyUrlForTarget: () => undefined,
  fetchTextThroughProxy: jest.fn(),
  fetchStreamThroughProxy: jest.fn(),
}));

it('刷新结果逐源累计成功、失败和禁用跳过数量', async () => {
  const text = '#EXTM3U\n#EXTINF:-1,测试频道\nhttps://example.com/live.m3u8';
  jest
    .mocked(fetchWithUrlGuard)
    .mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: jest
            .fn()
            .mockResolvedValueOnce({ done: false, value: Buffer.from(text) })
            .mockResolvedValue({ done: true }),
          releaseLock: jest.fn(),
          cancel: jest.fn().mockResolvedValue(undefined),
        }),
      },
    } as unknown as Response)
    .mockRejectedValueOnce(new Error('upstream failure'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const result = await refreshLiveChannelSources([
    {
      key: 'result-good',
      name: '正常源',
      url: 'https://example.com/good',
      from: 'custom',
    },
    {
      key: 'result-bad',
      name: '失败源',
      url: 'https://example.com/bad',
      from: 'custom',
    },
    {
      key: 'result-off',
      name: '禁用源',
      url: 'https://example.com/off',
      from: 'custom',
      disabled: true,
    },
  ]);
  expect(result).toEqual({
    refreshed: 1,
    failed: [{ key: 'result-bad', name: '失败源' }],
  });
  expect(fetchWithUrlGuard).toHaveBeenCalledTimes(2);
  log.mockRestore();
});
