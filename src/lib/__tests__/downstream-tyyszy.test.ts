/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { validateSourceSearch } from '@/features/admin/lib/source-search-validation.server';
import type { ApiSite } from '@/lib/config';
import {
  getDetailFromApi,
  searchFirstPageFromApi,
  searchFromApi,
} from '@/lib/downstream';
import {
  isTyyszySource,
  searchFromTyyszy,
} from '@/lib/downstream-sources/tyyszy';
import { clearSearchCachesForTests } from '@/lib/search-cache';
import { ResourceLimitError } from '@/lib/server-resource-errors';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: { headers: {} },
    detail: { headers: {}, path: '?ac=videolist&ids=' },
  },
  getConfigForRead: jest.fn().mockResolvedValue({ SiteConfig: {} }),
}));

installStreamPolyfills();
const originalFetch = global.fetch;
const site: ApiSite = {
  key: 'tyyszy',
  name: '天涯资源',
  api: 'https://tyyszy.com/api.php/provide/vod',
};
const item = {
  vod_id: 170,
  vod_name: '斗罗大陆2：绝世唐门2023',
  vod_pic: 'https://img.example/170.jpg',
  vod_year: '2023年',
  vod_class: '动画',
  type_name: '国产动漫',
  vod_content: '<p>作品简介</p>',
  vod_remarks: '更新至第2集',
  vod_douban_id: 123,
  vod_play_url:
    '预告$https://cdn.example/trailer.mp4$$$第01集$https://cdn.example/1.m3u8#第02集$https://cdn.example/2.m3u8',
};
const card = (id: string | number) =>
  `<a href="/index.php/vod/detail/id/${id}.html" class="movie-card" data-name="斗罗大陆">`;
const grid = (cards: string) =>
  `<div class="movie-grid" id="movieGrid">${cards}</div>`;
const response = (data: unknown) => new Response(JSON.stringify(data));

beforeEach(() => {
  clearSearchCachesForTests();
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  clearSearchCachesForTests();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each([
  ['https://tyyszy.com/api.php/provide/vod', true],
  ['https://www.tyyszy.com/api.php/provide/vod', true],
  ['https://api.sub.tyyszy.com/api', true],
  ['https://tyyszy.com.attacker.test/api', false],
  ['https://nottyyszy.com/api', false],
  ['https://example.com/tyyszy.com', false],
  ['invalid', false],
])('按 API 主机识别 %s', (api, expected) => {
  expect(isTyyszySource({ ...site, key: 'custom', api })).toBe(expected);
});

it('提取并去重卡片数字 id，一次批量详情后按网页顺序返回', async () => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock
    .mockResolvedValueOnce(
      new Response(
        `<div id='movieGrid'>${card(170)}${card(49466)}${card(170)}
        <a class='other movie-card selected' href='/index.php/vod/detail/id/22414.html'>
        <a href="/index.php/vod/detail/id/999.html">非搜索卡片</a>
        <a href="/index.php/vod/play/id/888.html">播放链接</a>
        </div><a class="page_link" href="/index.php/vod/search/page/105/wd/test.html" title="尾页">`,
      ),
    )
    .mockResolvedValueOnce(
      response({
        code: 1,
        list: [
          { ...item, vod_id: 22414 },
          item,
          { ...item, vod_id: '49466' },
          { ...item, vod_id: 999 },
        ],
      }),
    );
  const results = await searchFromTyyszy(site, '斗罗大陆');
  expect(results.map((result) => result.id)).toEqual(['170', '49466', '22414']);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const detailUrl = new URL(fetchMock.mock.calls[1][0]);
  expect(detailUrl.origin + detailUrl.pathname).toBe(site.api);
  expect(Object.fromEntries(detailUrl.searchParams)).toEqual({
    ac: 'detail',
    ids: '170,49466,22414',
  });
  expect(results[0]).toEqual({
    id: '170',
    title: item.vod_name,
    poster: item.vod_pic,
    episodes: ['https://cdn.example/1.m3u8', 'https://cdn.example/2.m3u8'],
    episodes_titles: ['第01集', '第02集'],
    source: site.key,
    source_name: site.name,
    class: '动画',
    year: '2023',
    desc: '作品简介',
    type_name: '国产动漫',
    series_status: 'ongoing',
    douban_id: 123,
  });
});

it('关键词使用 encodeURIComponent，批量详情保留源参数并清理搜索参数', async () => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock
    .mockResolvedValueOnce(new Response(grid(card(170))))
    .mockResolvedValueOnce(response({ list: [item] }));
  const query = "斗罗 A+B/&?#!'()*";
  await searchFromTyyszy(
    { ...site, api: `${site.api}?token=demo&wd=old&pg=9&ac=list` },
    query,
  );
  expect(fetchMock.mock.calls[0][0]).toBe(
    `https://tyyszy.com/index.php/vod/search.html?wd=${encodeURIComponent(query)}`,
  );
  expect(
    Object.fromEntries(new URL(fetchMock.mock.calls[1][0]).searchParams),
  ).toEqual({ token: 'demo', ac: 'detail', ids: '170' });
  const signal = fetchMock.mock.calls[0][1].signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
});

it('网页没有卡片时返回空数组且不请求详情', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(`<main>${grid('')}</main>`),
  );
  await expect(searchFromTyyszy(site, '不存在')).resolves.toEqual([]);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it.each([
  '<html><body>请完成验证</body></html>',
  '',
  `<div class="list">${card(170)}</div>`,
])('没有结果容器的页面按结构无法识别抛错 %j', async (html) => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(html));
  await expect(searchFromTyyszy(site, '斗罗')).rejects.toThrow(
    '天涯搜索页结构无法识别',
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it.each([
  '/index.php/vod/detail/id/abc.html',
  '/index.php/vod/detail/id/170.html?extra=1',
  '/index.php/vod/play/id/170.html',
  'https://other.test/index.php/vod/detail/id/170.html',
])('卡片链接全部无法识别时按模板变化抛错 %s', async (href) => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(grid(`<a class="movie-card" href="${href}">`)),
  );
  await expect(searchFromTyyszy(site, '斗罗')).rejects.toThrow(
    '天涯搜索条目地址无法识别',
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('跳过个别格式异常的卡片链接', async () => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(
      new Response(
        grid(
          `<a class="movie-card" href="/index.php/vod/play/id/9.html">${card(170)}`,
        ),
      ),
    )
    .mockResolvedValueOnce(response({ list: [item] }));
  expect(
    (await searchFromTyyszy(site, '斗罗')).map((result) => result.id),
  ).toEqual(['170']);
  expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('ids=170');
});

it.each(['网页', '详情'])('%s 非 2xx 时取消正文并抛错', async (stage) => {
  const fetchMock = global.fetch as jest.Mock;
  const cancel = jest.fn().mockResolvedValue(undefined);
  if (stage === '详情')
    fetchMock.mockResolvedValueOnce(new Response(grid(card(170))));
  fetchMock.mockResolvedValueOnce({ ok: false, status: 503, body: { cancel } });
  await expect(searchFromTyyszy(site, '斗罗')).rejects.toThrow('(503)');
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each(['网页', '详情'])('%s 网络异常时抛错', async (stage) => {
  const fetchMock = global.fetch as jest.Mock;
  if (stage === '详情')
    fetchMock.mockResolvedValueOnce(new Response(grid(card(170))));
  fetchMock.mockRejectedValueOnce(new TypeError('network error'));
  await expect(searchFromTyyszy(site, '斗罗')).rejects.toThrow(
    '请求失败 (TypeError)',
  );
});

it('详情不是 JSON 时抛错', async () => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(new Response(grid(card(170))))
    .mockResolvedValueOnce(new Response('暂不支持搜索'));
  await expect(searchFromTyyszy(site, '斗罗')).rejects.toThrow();
});

it.each([
  { code: 0, list: [item] },
  { list: null },
  { list: [] },
  { list: [null, { vod_name: '斗罗' }, { vod_id: 170, vod_name: 12 }] },
  { list: [{ ...item, vod_id: 999 }] },
])('网页有 id 而详情全部无效或缺失时抛错 %j', async (data) => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(new Response(grid(card(170))))
    .mockResolvedValueOnce(response(data));
  await expect(searchFromTyyszy(site, '斗罗')).rejects.toThrow('天涯批量详情');
});

it('详情有效但都没有剧集时与普通源一致返回空结果', async () => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(new Response(grid(card(170))))
    .mockResolvedValueOnce(response({ list: [{ ...item, vod_play_url: '' }] }));
  await expect(searchFromTyyszy(site, '斗罗')).resolves.toEqual([]);
});

it('部分详情无效时跳过无效条目并保持剩余条目的搜索顺序', async () => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(
      new Response(grid(`${card(170)}${card(2)}${card(3)}`)),
    )
    .mockResolvedValueOnce(
      response({
        list: [
          null,
          { vod_id: 2, vod_name: false },
          { vod_name: '无编号' },
          { ...item, vod_id: 3 },
          item,
        ],
      }),
    );
  expect(
    (await searchFromTyyszy(site, '斗罗')).map((result) => result.id),
  ).toEqual(['170', '3']);
});

it('资源限额保持原错误类型', async () => {
  const error = new ResourceLimitError();
  (global.fetch as jest.Mock).mockRejectedValueOnce(error);
  await expect(searchFromTyyszy(site, '斗罗')).rejects.toBe(error);
});

it.each(['父级取消', '超时'])('网页与详情请求响应%s', async (reason) => {
  jest.useFakeTimers();
  const parent = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(grid(card(170))));
            controller.close();
          },
        }),
      ),
    )
    .mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason),
          );
          started();
        }),
    );
  const result = searchFromTyyszy(site, '斗罗', parent.signal);
  const assertion = expect(result).rejects.toBeDefined();
  await ready;
  if (reason === '父级取消') parent.abort();
  else jest.advanceTimersByTime(10000);
  await assertion;
});

it('网页耗时占用批量详情的同一十秒预算', async () => {
  jest.useFakeTimers();
  let detailSignal: AbortSignal | undefined;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  (global.fetch as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                new Response(
                  new ReadableStream({
                    start(controller) {
                      controller.enqueue(
                        new TextEncoder().encode(grid(card(170))),
                      );
                      controller.close();
                    },
                  }),
                ),
              ),
            6000,
          );
        }),
    )
    .mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          detailSignal = init.signal as AbortSignal;
          detailSignal.addEventListener('abort', () =>
            reject(detailSignal?.reason),
          );
          started();
        }),
    );
  const pending = searchFromTyyszy(site, '斗罗');
  const assertion = expect(pending).rejects.toThrow('timeout');
  jest.advanceTimersByTime(6000);
  await ready;
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(detailSignal?.aborted).toBe(false);
  jest.advanceTimersByTime(3999);
  expect(detailSignal?.aborted).toBe(false);
  jest.advanceTimersByTime(1);
  await assertion;
  expect(detailSignal?.aborted).toBe(true);
});

it('统一搜索入口只取第一页，后台手动检测同样调用网页与批量详情', async () => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockImplementation(async (url: string) =>
    url.startsWith(site.api)
      ? response({ list: [item] })
      : new Response(
          `${grid(card(170))}<a class="page_link" href="/index.php/vod/search/page/105/wd/test.html" title="尾页">`,
        ),
  );
  const results = await searchFromApi(site, '斗罗', { maxSearchPages: 10 });
  expect(results).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await searchFirstPageFromApi(site, '斗罗')).toEqual(results);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    await validateSourceSearch(site, '斗罗', new AbortController().signal),
  ).toBe('valid');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it.each([undefined, 'https://tyyszy.com'])(
  '详情沿用普通 CMS 路径（详情页配置 %s）',
  async (detail) => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      response({ list: [item] }),
    );
    const result = await getDetailFromApi({ ...site, detail }, '170');
    expect(result.episodes).toEqual([
      'https://cdn.example/1.m3u8',
      'https://cdn.example/2.m3u8',
    ]);
    expect(result.episodes_titles).toEqual(['第01集', '第02集']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      `${site.api}?ac=videolist&ids=170`,
      expect.any(Object),
    );
  },
);
