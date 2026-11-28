import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import type { ApiSite } from '@/lib/config';
import { getDetailFromApi, searchFirstPageFromApi } from '@/lib/downstream';
import {
  getDetailFromGirigiri,
  resolveGirigiriEpisodePlayUrlByPath,
  searchFromGirigiri,
} from '@/lib/downstream-sources/giri';
import { ResourceLimitError } from '@/lib/server-resource-errors';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: {},
    detail: { path: '/api.php/provide/vod/?ac=detail&ids=', headers: {} },
  },
  getConfigForRead: jest.fn().mockResolvedValue({
    SiteConfig: require('@/lib/runtime-params').DEFAULT_RUNTIME_PARAMS,
  }),
}));

installStreamPolyfills();
const originalFetch = global.fetch;
const site: ApiSite = {
  key: 'giri',
  name: 'Giri',
  api: 'https://anime.girigirilove.icu',
};
const item = {
  vod_id: 26879,
  vod_name: '葬送的芙莉莲 第二季',
  vod_pic: 'https://jpg.girigirilove.com/upload/vod/cover.webp',
  vod_year: '2026',
  vod_blurb: '简介',
};
const detailItem = {
  ...item,
  vod_pic: 'upload/vod/cover.webp',
  vod_content: '<p>详情&amp;简介</p>',
  vod_play_from: 'cht$$$chs',
  vod_play_url:
    '01$https://ana.girigirilove.com/cht/01.mp4#02$https://ana.girigirilove.com/cht/02.mp4$$$01$https://akua.girigirilove.com/chs/01/playlist.m3u8#02$https://akua.girigirilove.com/chs/02/playlist.m3u8',
};
function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value));
}
function listResponse(rows: unknown[]) {
  return jsonResponse({
    code: 1,
    info: { offset: 0, limit: 20, total: rows.length, rows },
  });
}

beforeEach(() => {
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('giri 搜索失败诊断', () => {
  const query = '私密搜索词';
  it('HTTP 失败带状态码，并取消正文', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      body: { cancel },
    });
    await expect(searchFromGirigiri(site, query)).rejects.toThrow(
      'girigiri 搜索请求失败 (503)',
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('网络错误保留底层类型，消息排除关键词与完整地址', async () => {
    const error = Object.assign(
      new TypeError(`fetch failed https://example.test/?q=${query}`),
      {
        cause: { code: 'ECONNRESET' },
      },
    );
    (global.fetch as jest.Mock).mockRejectedValue(error);
    const pending = searchFromGirigiri(site, query);
    await expect(pending).rejects.toThrow('TypeError:ECONNRESET');
    await expect(pending).rejects.not.toThrow(query);
    await expect(pending).rejects.not.toThrow('https://');
  });

  it.each([
    ['invalid', '搜索请求失败 (SyntaxError)'],
    [JSON.stringify({ error: 'unavailable' }), '搜索响应无效'],
  ])('异常响应给出安全的解析原因：%s', async (payload, message) => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(payload === 'invalid' ? `invalid ${query}` : payload),
    );
    const pending = searchFromGirigiri(site, query);
    await expect(pending).rejects.toThrow(message);
    await expect(pending).rejects.not.toThrow(query);
  });

  it('内部超时与网络错误分开报告', async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const assertion = expect(searchFromGirigiri(site, query)).rejects.toThrow(
      'girigiri 搜索请求超时',
    );
    jest.advanceTimersByTime(8000);
    await assertion;
  });

  it.each([false, true])(
    '父级取消保持原始原因，预先取消=%s',
    async (alreadyAborted) => {
      const controller = new AbortController();
      (global.fetch as jest.Mock).mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(init.signal?.reason),
            );
          }),
      );
      if (alreadyAborted) controller.abort();
      const pending = searchFromGirigiri(site, query, controller.signal);
      controller.abort();
      if (alreadyAborted) {
        await expect(pending).resolves.toEqual([]);
      } else {
        await expect(pending).rejects.toBe(controller.signal.reason);
      }
      expect(global.fetch).toHaveBeenCalledTimes(alreadyAborted ? 0 : 1);
    },
  );

  it('ResourceLimitError 保持同一错误对象', async () => {
    const error = new ResourceLimitError();
    (global.fetch as jest.Mock).mockRejectedValue(error);
    await expect(searchFromGirigiri(site, query)).rejects.toBe(error);
  });
});

describe('downstream giri JSON API', () => {
  it('旧源配置搜索固定新版 API 第一页，并编码关键词', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(listResponse([item]));
    const results = await searchFirstPageFromApi(site, '葬送 &');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://m3u8.girigirilove.com/api.php/Vod/get_list?vod_name=%E8%91%AC%E9%80%81%20%26&limit=20&offset=0',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      expect.objectContaining({
        id: '26879',
        title: item.vod_name,
        poster: item.vod_pic,
        year: '2026',
        desc: '简介',
        source: 'giri',
        episodes: [],
      }),
    ]);
  });

  it('其他 girigirilove 入口使用相同固定接口，标题解码实体', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      listResponse([
        { ...item, vod_id: '26879', vod_name: '丧失篇&amp;夺还篇' },
      ]),
    );
    const results = await searchFromGirigiri(
      { ...site, api: 'https://ani.girigirilove.com' },
      'entity',
    );
    expect(results[0]).toMatchObject({ id: '26879', title: '丧失篇&夺还篇' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://m3u8.girigirilove.com/api.php/Vod/get_list?vod_name=entity&limit=20&offset=0',
      expect.any(Object),
    );
  });

  it('成功空结果返回空数组，非空结果复用共享缓存', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValue(listResponse([item]));
    await expect(searchFirstPageFromApi(site, 'reuse')).resolves.toEqual([]);
    const first = await searchFirstPageFromApi(site, 'reuse');
    const second = await searchFirstPageFromApi(site, 'reuse');
    expect(first).toEqual([expect.objectContaining({ id: '26879' })]);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: 0, info: { rows: [] } },
    { code: 1, info: { rows: null } },
    { code: 1, info: [] },
    { code: 1, info: { rows: [null, {}, { vod_id: 1, vod_name: 42 }] } },
  ])('拒绝失败码、错误列表结构与全脏列表 %p', async (payload) => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(payload));
    await expect(searchFromGirigiri(site, 'invalid')).rejects.toThrow(
      '搜索响应无效',
    );
  });

  it('混合列表跳过坏条目并规范化可选字段与 URL 协议', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      listResponse([
        null,
        { vod_id: {}, vod_name: 'bad' },
        { ...item, vod_id: -1 },
        {
          ...item,
          vod_pic: 'javascript:alert(1)',
          vod_year: {},
          vod_blurb: [],
          vod_class: 12,
        },
      ]),
    );
    expect(await searchFromGirigiri(site, 'mixed')).toEqual([
      expect.objectContaining({
        id: '26879',
        poster: '',
        year: 'unknown',
        desc: '',
        class: '',
      }),
    ]);
  });

  it('搜索消费者取消时返回空结果', async () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise<Response>(() => {}),
    );
    const controller = new AbortController();
    const pending = searchFirstPageFromApi(site, 'abort', {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toEqual([]);
  });

  it.each(['26879', '26879__giri_2'])(
    '详情 %s 一次请求直出两组地址，保持作品与集数身份',
    async (id) => {
      const fetchMock = global.fetch as jest.Mock;
      fetchMock.mockResolvedValue(jsonResponse({ code: 1, info: detailItem }));
      const detail = await getDetailFromApi(site, id);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://m3u8.girigirilove.com/api.php/Vod/get_detail?vod_id=26879',
        expect.any(Object),
      );
      expect(detail).toMatchObject({
        id: '26879',
        title: item.vod_name,
        poster: item.vod_pic,
        desc: '详情&简介',
        episodes: [
          'https://ana.girigirilove.com/cht/01.mp4',
          'https://ana.girigirilove.com/cht/02.mp4',
          'https://akua.girigirilove.com/chs/01/playlist.m3u8',
          'https://akua.girigirilove.com/chs/02/playlist.m3u8',
        ],
        episodes_titles: ['01', '02', '01', '02'],
        episode_groups: [
          { label: '繁中', count: 2 },
          { label: '简中', count: 2 },
        ],
      });
      expect(detail.related_sources).toBeUndefined();
    },
  );

  it.each(['bad', '1&vod_id=2', '0', '123__giri_x'])(
    '无效作品 id %s 在回源前拒绝',
    async (id) => {
      await expect(getDetailFromGirigiri(site, id)).rejects.toThrow(
        '无效的 girigiri 编号',
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    { code: 0, info: detailItem },
    { code: 1, info: {} },
    { code: 1, info: { ...detailItem, vod_id: 1 } },
    { code: 1, info: { ...detailItem, vod_name: {} } },
    { code: 1, info: { ...detailItem, vod_play_url: null } },
  ])('详情错误响应显式失败 %p', async (payload) => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(payload));
    await expect(getDetailFromGirigiri(site, '26879')).rejects.toThrow(
      'girigiri',
    );
  });
});

describe('旧 lazy 兼容解析', () => {
  it.each([
    ['https://cdn.example/video.m3u8', 0],
    ['https://cdn.example/video.mp4?token=abc', 0],
    ['https://ana.girigirilove.com/01.mp4', 1],
    ['https://ana.girigirilove.com/01.mp4', 2],
  ])('播放页地址 %s，encrypt=%s', async (url, encrypt) => {
    const encoded = encodeURIComponent(url as string);
    const raw =
      encrypt === 2
        ? Buffer.from(encoded).toString('base64')
        : encrypt === 1
          ? encoded
          : url;
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(`var player_aaaa={"encrypt":${encrypt},"url":"${raw}"};`),
    );
    await expect(
      resolveGirigiriEpisodePlayUrlByPath(site, '/playGV26879-1-1/'),
    ).resolves.toBe(url);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://anime.girigirilove.icu/playGV26879-1-1/',
      expect.any(Object),
    );
  });

  it('拒绝非播放页路径与非法播放协议', async () => {
    await expect(
      resolveGirigiriEpisodePlayUrlByPath(site, '//other.example/'),
    ).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        'var player_aaaa={"encrypt":0,"url":"javascript:alert(1)"};',
      ),
    );
    await expect(
      resolveGirigiriEpisodePlayUrlByPath(site, '/playGV26879-1-1/'),
    ).resolves.toBeNull();
  });
});

describe('通用 CMS 媒体与实体兼容', () => {
  const genericSite: ApiSite = {
    key: 'generic-mp4',
    name: 'Generic MP4',
    api: 'https://api.example',
  };
  it('通用 CMS 搜索解码标题与剧集名的 HTML 实体', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        pagecount: 1,
        list: [
          {
            vod_id: 301,
            vod_name: '  丧失篇&amp;夺还篇  ',
            vod_pic: 'https://cdn.example/poster.jpg',
            vod_play_url:
              '前篇&amp;后篇$https://cdn.example/video.m3u8#第2集$https://cdn.example/ep2.m3u8',
            vod_year: '2026',
            vod_content: '',
          },
        ],
      }),
    );
    const results = await searchFirstPageFromApi(genericSite, 'entity');
    expect(results[0]).toEqual(
      expect.objectContaining({
        title: '丧失篇&夺还篇',
        episodes_titles: ['前篇&后篇', '第2集'],
      }),
    );
  });

  it('通用 CMS 搜索会保留 mp4 播放地址', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse({
        pagecount: 1,
        list: [
          {
            vod_id: 300,
            vod_name: 'MP4 Video',
            vod_pic: 'https://cdn.example/poster.jpg',
            vod_play_url:
              '第1集$https://cdn.example/video.mp4?token=abc#第2集$https://cdn.example/video.m3u8',
            vod_year: '2026',
            vod_content: '',
          },
        ],
      }),
    );
    const results = await searchFirstPageFromApi(genericSite, 'mp4');
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: '300',
        episodes: [
          'https://cdn.example/video.mp4?token=abc',
          'https://cdn.example/video.m3u8',
        ],
      }),
    );
  });
});
