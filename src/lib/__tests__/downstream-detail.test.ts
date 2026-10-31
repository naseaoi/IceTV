import type { ApiSite } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';

const originalFetch = global.fetch;

const SITE: ApiSite = {
  key: 'jisu',
  name: '极速资源',
  api: 'https://api.example.com/api.php/provide/vod',
  detail: 'https://page.example.com',
};
const PAGE_URL = 'https://page.example.com/index.php/vod/detail/id/110900.html';

const API_ITEM = {
  vod_id: 110900,
  vod_name: '测试动画',
  vod_pic: 'https://img.example.com/api.jpg',
  vod_class: '动画,日本动漫',
  vod_year: '2026',
  vod_content: '接口简介<br>',
  type_name: '日本动漫',
  vod_douban_id: 38194261,
  vod_play_url:
    '第1集$https://v.example.com/api/1/index.m3u8#第2集$https://v.example.com/api/2/index.m3u8',
};

const PAGE_HTML = `
  <h1>页面标题</h1>
  <img src="https://img.example.com/page.jpg">
  <span>2026</span>
  <li>第1集$https://v.example.com/page/1/index.m3u8</li>
`;

function mockResponses(api: unknown, page = PAGE_HTML) {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === PAGE_URL) {
      return { ok: true, url, text: async () => page } as Response;
    }
    if (api instanceof Error) throw api;
    return { ok: true, url, json: async () => api } as Response;
  });
  return fetchMock;
}

describe('配置了详情页的源', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('接口有可播放剧集时直接用接口详情，不抓详情页', async () => {
    const fetchMock = mockResponses({ list: [API_ITEM] });

    const detail = await getDetailFromApi(SITE, '110900');

    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
      PAGE_URL,
    );
    expect(detail).toEqual(
      expect.objectContaining({
        title: '测试动画',
        class: '动画,日本动漫',
        type_name: '日本动漫',
        desc: '接口简介',
        douban_id: 38194261,
        episodes: [
          'https://v.example.com/api/1/index.m3u8',
          'https://v.example.com/api/2/index.m3u8',
        ],
      }),
    );
  });

  it('接口没有可播放剧集时剧集取详情页，元数据保留接口字段', async () => {
    mockResponses({ list: [{ ...API_ITEM, vod_play_url: '' }] });

    const detail = await getDetailFromApi(SITE, '110900');

    expect(detail).toEqual(
      expect.objectContaining({
        title: '页面标题',
        poster: 'https://img.example.com/page.jpg',
        class: '动画,日本动漫',
        type_name: '日本动漫',
        desc: '接口简介',
        douban_id: 38194261,
        episodes: ['https://v.example.com/page/1/index.m3u8'],
        episodes_titles: ['1'],
      }),
    );
  });

  it('接口请求失败时退回详情页', async () => {
    mockResponses(new Error('network'));

    const detail = await getDetailFromApi(SITE, '110900');

    expect(detail).toEqual(
      expect.objectContaining({
        title: '页面标题',
        episodes: ['https://v.example.com/page/1/index.m3u8'],
        class: '',
        douban_id: 0,
      }),
    );
  });
});
