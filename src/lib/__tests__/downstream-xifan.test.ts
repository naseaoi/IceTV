import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import type { ApiSite } from '@/lib/config';
import { getDetailFromApi, searchFirstPageFromApi } from '@/lib/downstream';
import {
  isXifanSource,
  resolveXifanEpisodeUrlByPath,
  searchFromXifan,
} from '@/lib/downstream-sources/xifan';
import { parseLazyEpisodeUrl } from '@/lib/lazy-episodes';

jest.mock('@/lib/config', () => ({
  API_CONFIG: { search: { headers: {} }, detail: { headers: {} } },
  getConfigForRead: jest.fn().mockResolvedValue({
    SiteConfig: require('@/lib/runtime-params').DEFAULT_RUNTIME_PARAMS,
  }),
}));
jest.mock('@/lib/url-guard', () => ({
  validateProxyUrlForRequest: async (url: string) => ({ ok: true, url }),
}));

installStreamPolyfills();
const originalFetch = global.fetch;
const site: ApiSite = {
  key: 'xifan',
  name: '稀饭动漫',
  api: 'https://next.xifanacg.com',
};
const anime = {
  id: 26,
  title: '葬送的芙莉莲',
  cover_url: 'https://img.example/26.jpg',
  release_year: 2023,
  is_finished: true,
};
const episode = { id: 329, kind: 'main', episode_number: 1, title: '冒险结束' };
const lazyPath = '/anime/26/episode/329/source/2';

function response(data: unknown) {
  return new Response(JSON.stringify(data));
}

beforeEach(() => {
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

it('通过统一搜索入口读取游客 API 并区分空结果与错误响应', async () => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockResolvedValueOnce(response([anime]));
  const results = await searchFirstPageFromApi(site, '葬送');
  expect(results).toEqual([
    expect.objectContaining({
      id: '26',
      title: anime.title,
      year: '2023',
      episodes: [],
      series_status: 'ended',
    }),
  ]);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.xifanacg.com/rest/v1/rpc/search_animes',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        search_term: '葬送',
        page_number: 1,
        items_per_page: 24,
      }),
    }),
  );
  fetchMock.mockResolvedValueOnce(response([]));
  await expect(searchFromXifan(site, '不存在')).resolves.toEqual([]);
  fetchMock.mockResolvedValueOnce(response({ error: 'unavailable' }));
  await expect(searchFromXifan(site, '不存在')).rejects.toThrow('搜索响应无效');
  expect(
    isXifanSource({ ...site, api: 'https://next.xifanacg.com.attacker.test' }),
  ).toBe(false);
});

it('详情只保留备用线路并生成带集号的懒地址，不提前取播放地址', async () => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockResolvedValueOnce(
    response({
      anime,
      sources: [
        { id: 5, code: 'xfy2', episodes: [episode, { ...episode, id: 999 }] },
        { id: 2, code: 'CS', episodes: [episode] },
      ],
    }),
  );
  const detail = await getDetailFromApi(site, '26');
  expect(detail.episodes).toEqual([`icetv-lazy://xifan${lazyPath}`]);
  expect(detail.episodes_titles).toEqual(['第1集']);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(parseLazyEpisodeUrl(detail.episodes[0])).toEqual({
    kind: 'xifan',
    path: lazyPath,
  });
  expect(parseLazyEpisodeUrl(`${detail.episodes[0]}/../5`)).toBeNull();
  fetchMock.mockResolvedValueOnce(
    response({
      anime,
      sources: [{ id: 5, code: 'xfy2', episodes: [episode] }],
    }),
  );
  await expect(getDetailFromApi(site, '26')).rejects.toThrow(
    '备用线路暂无剧集',
  );
});

it('解析选择同一备用线路，拒绝上游自动回落到主线的地址', async () => {
  const fetchMock = global.fetch as jest.Mock;
  const primary = {
    source_id: 5,
    source_code: 'xfy2',
    url: 'https://main.example/1.mp4',
  };
  const backup = {
    source_id: 2,
    source_code: 'CS',
    url: 'https://dl.playxf.top/1.m3u8',
  };
  fetchMock.mockResolvedValueOnce(
    response({ ok: true, url: primary.url, candidates: [primary, backup] }),
  );
  await expect(resolveXifanEpisodeUrlByPath(site, lazyPath)).resolves.toBe(
    backup.url,
  );
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.xifanacg.com/functions/v1/issue-web-playback',
    expect.objectContaining({
      body: JSON.stringify({
        action: 'fallback',
        episode_id: 329,
        source_id: 2,
      }),
    }),
  );
  fetchMock.mockResolvedValueOnce(
    response({ ok: true, url: primary.url, candidates: [primary] }),
  );
  await expect(resolveXifanEpisodeUrlByPath(site, lazyPath)).rejects.toThrow(
    '备用播放地址不可用',
  );
  const count = fetchMock.mock.calls.length;
  await expect(
    resolveXifanEpisodeUrlByPath(
      site,
      '/anime/26/episode/329/source/2?source=5',
    ),
  ).rejects.toThrow('无效的稀饭集数地址');
  expect(fetchMock).toHaveBeenCalledTimes(count);
});

it.each([
  null,
  { ...anime, id: 0 },
  { ...anime, id: { toString: 1 } },
  { ...anime, id: '9007199254740992' },
  { ...anime, title: '  ' },
])('搜索跳过脏条目 %j，全脏结果与详情保持失败', async (invalid) => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockResolvedValueOnce(response([invalid, anime]));
  expect(await searchFromXifan(site, '葬送')).toEqual([
    expect.objectContaining({ id: '26', title: anime.title }),
  ]);
  fetchMock.mockResolvedValueOnce(response([invalid]));
  await expect(searchFromXifan(site, '葬送')).rejects.toThrow('搜索响应无效');
  fetchMock.mockResolvedValueOnce(response({ anime: invalid, sources: [] }));
  await expect(getDetailFromApi(site, '26')).rejects.toThrow('详情响应无效');
});

it.each([
  '/anime/0/episode/329/source/2',
  '/anime/26/episode/329/source/02',
  '/anime/9007199254740992/episode/329/source/2',
  '/anime/26/episode/9007199254740992/source/2',
  '/anime/26/episode/329/source/9007199254740992',
  '/anime/26/episode/329/source/2/../5',
])('无效路径 %s 在请求前被拒绝', async (path) => {
  await expect(resolveXifanEpisodeUrlByPath(site, path)).rejects.toThrow(
    '无效的稀饭集数地址',
  );
  expect(global.fetch).not.toHaveBeenCalled();
});
