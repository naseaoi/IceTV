import type { ApiSite } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import type { SearchResult } from '@/lib/types';

jest.mock('@/lib/downstream', () => ({
  getDetailFromApi: jest.fn(),
}));

const { clearDetailCacheForTests, getCachedDetail } =
  require('@/lib/detail-cache') as typeof import('@/lib/detail-cache');

const mockGetDetailFromApi = getDetailFromApi as jest.Mock;

const site = { key: 'demo', name: 'demo', api: 'https://demo.test' } as ApiSite;
const otherSite = {
  key: 'other',
  name: 'other',
  api: 'https://other.test',
} as ApiSite;

function makeDetail(id: string): SearchResult {
  return { id, title: `title-${id}`, episodes: ['ep1'] } as SearchResult;
}

describe('detail-cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearDetailCacheForTests();
    mockGetDetailFromApi.mockImplementation((_site: ApiSite, id: string) =>
      Promise.resolve(makeDetail(id)),
    );
  });

  it('相同源与 id 只回源一次', async () => {
    const first = await getCachedDetail(site, 'abc');
    const second = await getCachedDetail(site, 'abc');

    expect(first).toEqual(makeDetail('abc'));
    expect(second).toEqual(makeDetail('abc'));
    expect(mockGetDetailFromApi).toHaveBeenCalledTimes(1);
  });

  it('并发请求合并为一次回源', async () => {
    const [a, b, c] = await Promise.all([
      getCachedDetail(site, 'abc'),
      getCachedDetail(site, 'abc'),
      getCachedDetail(site, 'abc'),
    ]);

    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(mockGetDetailFromApi).toHaveBeenCalledTimes(1);
  });

  it('不同源的同一 id 不共用条目', async () => {
    await getCachedDetail(site, 'abc');
    await getCachedDetail(otherSite, 'abc');

    expect(mockGetDetailFromApi).toHaveBeenCalledTimes(2);
    expect(mockGetDetailFromApi).toHaveBeenNthCalledWith(1, site, 'abc');
    expect(mockGetDetailFromApi).toHaveBeenNthCalledWith(2, otherSite, 'abc');
  });

  it('回源失败不写入缓存', async () => {
    mockGetDetailFromApi.mockRejectedValueOnce(new Error('boom'));

    await expect(getCachedDetail(site, 'abc')).rejects.toThrow('boom');
    await expect(getCachedDetail(site, 'abc')).resolves.toEqual(
      makeDetail('abc'),
    );
    expect(mockGetDetailFromApi).toHaveBeenCalledTimes(2);
  });
});
