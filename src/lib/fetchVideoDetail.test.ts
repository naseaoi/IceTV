import { getAvailableApiSites } from '@/lib/config';
import { getDetailFromApi, searchFromApi } from '@/lib/downstream';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: jest.fn(),
}));

jest.mock('@/lib/downstream', () => ({
  getDetailFromApi: jest.fn(),
  searchFromApi: jest.fn(),
}));

const mockGetAvailableApiSites = getAvailableApiSites as jest.Mock;
const mockGetDetailFromApi = getDetailFromApi as jest.Mock;
const mockSearchFromApi = searchFromApi as jest.Mock;

const apiSite = {
  key: 'source-a',
  api: 'https://example.com/api',
  name: '源站',
};

describe('fetchVideoDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAvailableApiSites.mockResolvedValue([apiSite]);
  });

  it('已知 source 和 id 时直接请求详情', async () => {
    const detail = { source: 'source-a', id: 'video-1', title: '详情' };
    mockGetDetailFromApi.mockResolvedValue(detail);

    await expect(
      fetchVideoDetail({
        source: 'source-a',
        id: 'video-1',
        fallbackTitle: '标题',
      }),
    ).resolves.toEqual(detail);

    expect(mockGetDetailFromApi).toHaveBeenCalledWith(apiSite, 'video-1');
    expect(mockSearchFromApi).not.toHaveBeenCalled();
  });

  it('详情失败后才使用标题搜索回退', async () => {
    mockGetDetailFromApi.mockRejectedValue(new Error('详情失败'));
    mockSearchFromApi.mockResolvedValue([
      { source: 'source-a', id: 'video-1', title: '搜索结果' },
    ]);

    await expect(
      fetchVideoDetail({
        source: 'source-a',
        id: 'video-1',
        fallbackTitle: '标题',
      }),
    ).resolves.toEqual({
      source: 'source-a',
      id: 'video-1',
      title: '搜索结果',
    });
  });
});
