/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import type { ApiSite } from '@/lib/config';
import {
  getDetailFromPpnix,
  isPpnixSource,
  searchFromPpnix,
} from '@/lib/downstream-sources/ppnix';
import { ResourceLimitError } from '@/lib/server-resource-errors';

installStreamPolyfills();
const originalFetch = global.fetch;
const site: ApiSite = {
  key: 'ppnix',
  name: 'PPnix',
  api: 'https://www.ppnix.com',
};

// 从实际搜索页和详情页精简，保留承载字段与播放参数的结构。
const card = (kind = 'tv', id = '1804', title = '庆余年 第一季') => `
<li><a href="/cn/${kind}/${id}.html" class="thumbnail" target="_blank">
<img referrerpolicy="no-referrer" src="/poster/${id}.webp" class="thumb" alt="${title}">
<div class="countrie"><span class="orange">2019</span></div></a>
<h2><a href="/cn/${kind}/${id}.html" target="_blank" title="${title}">${title}</a></h2>
<footer><span class="star star40"></span><span class="rate">8.2</span></footer></li>`;
const list = (cards: string) =>
  `<div class="lists-content"><ul>${cards}</ul></div>`;
// 标题行在中文名后追加原名，封面 alt 只含中文名。
const detail = (kind = 'tv', id = '1804', params = "'1','2','46'") => `
<header class="product-header"><img src="/poster/${id}.webp" class="thumb" alt="${kind === 'tv' ? '庆余年 第一季' : '流浪地球2'}">
<h1 class="product-title">${kind === 'tv' ? '庆余年 第一季 Joy of Life' : '流浪地球2 The Wandering Earth II'} <span>(2019)</span> <span class="star star40"></span> <span class="rate">8.2</span></h1>
<div class="product-excerpt">类型：<span><a href="/cn/tv/剧情----.html">剧情</a> / <a href="/cn/tv/古装----.html">古装</a></span></div>
<div class="product-excerpt">简介：<span>少年范闲，<b>前赴京都</b>。</span></div></header>
<article class="article-content"><div class="video"></div></article>
<div class="playlists" id="slider"></div>
<script>classid=${kind === 'tv' ? 2 : 1};classurl='/${kind}/';infoid=${id};sub='|en|cn|tw|';m3u8=[${params}]</script>`;

beforeEach(() => {
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

it.each([
  ['https://www.ppnix.com', true],
  ['https://ppnix.com/cn/', true],
  ['https://sub.ppnix.com', true],
  ['https://ppnix.com.attacker.test', false],
  ['https://notppnix.com', false],
  ['https://cms.example/api/ppnix.com?url=https://www.ppnix.com', false],
  ['invalid', false],
])('只按主机名识别 %s', (api, expected) => {
  expect(isPpnixSource({ ...site, api })).toBe(expected);
});

it('搜索第一页并提取类型、标题、封面和年份，去重且保留页面顺序', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(
      list(card() + card('movie', '2484', '流浪地球2 &amp; 地球') + card()) +
        '<div class="pagination"><a href="/cn/search/test-1-.html">下一页</a></div>',
    ),
  );
  const result = await searchFromPpnix(site, '庆余年');
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({
    id: 'tv-1804',
    title: '庆余年 第一季',
    poster: `${site.api}/poster/1804.webp`,
    year: '2019',
    type_name: '电视剧',
    episodes: [],
    episodes_titles: [],
    source: site.key,
    source_name: site.name,
    douban_id: 0,
  });
  expect(result[1]).toMatchObject({
    id: 'movie-2484',
    title: '流浪地球2 & 地球',
    type_name: '电影',
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('搜索使用源 origin 并编码关键词，传递取消信号', async () => {
  const parent = new AbortController();
  const query = '庆余年 /?&+';
  (global.fetch as jest.Mock).mockImplementationOnce(async (_url, init) => {
    parent.abort();
    expect(init.signal.aborted).toBe(true);
    return new Response(list(''));
  });
  await searchFromPpnix(
    { ...site, api: `${site.api}/cn/?x=1` },
    query,
    parent.signal,
  );
  expect(global.fetch).toHaveBeenCalledWith(
    `${site.api}/cn/search/${encodeURIComponent(query)}--.html`,
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({
        Accept: expect.stringContaining('text/html'),
      }),
    }),
  );
});

it('真实空结果结构返回空数组', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(list('')));
  await expect(searchFromPpnix(site, '不存在')).resolves.toEqual([]);
});

it.each(['', '<html>验证中</html>', `<div>${card()}</div>`])(
  '缺少搜索结果容器时抛错 %s',
  async (html) => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(html));
    await expect(searchFromPpnix(site, 'test')).rejects.toThrow(
      'PPnix 搜索页结构无法识别',
    );
  },
);

it.each([
  card('tv', '../1804'),
  card('other'),
  '<li>未知模板</li>',
  '<li>截断卡片',
])('条目全部无法识别时抛错', async (cards) => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(list(cards)));
  await expect(searchFromPpnix(site, 'test')).rejects.toThrow(
    'PPnix 搜索条目无法识别',
  );
});

it('跳过个别坏条目，非四位年份使用 unknown', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(list(card('other') + card().replace('2019', '2019年'))),
  );
  const results = await searchFromPpnix(site, 'test');
  expect(results).toHaveLength(1);
  expect(results[0].year).toBe('unknown');
});

it('电影详情按页面画质返回单个无签名清单', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(detail('movie', '2484', "'1080P'")),
  );
  const result = await getDetailFromPpnix(site, 'movie-2484');
  expect(result).toMatchObject({
    id: 'movie-2484',
    title: '流浪地球2',
    type_name: '电影',
    year: '2019',
    poster: `${site.api}/poster/2484.webp`,
    douban_id: 0,
    episodes: [`${site.api}/info/m3u8/2484/1080P.m3u8`],
    episodes_titles: ['正片'],
  });
  expect(global.fetch).toHaveBeenCalledWith(
    `${site.api}/cn/movie/2484.html`,
    expect.any(Object),
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('多画质仅取最高档', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(detail('movie', '2484', "'720P','1080P'")),
  );
  expect((await getDetailFromPpnix(site, 'movie-2484')).episodes).toEqual([
    `${site.api}/info/m3u8/2484/1080P.m3u8`,
  ]);
});

it('剧集详情按内联数组生成确定地址并规范集名，清理简介 HTML', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(detail()));
  const result = await getDetailFromPpnix(site, 'tv-1804');
  expect(result).toMatchObject({
    id: 'tv-1804',
    title: '庆余年 第一季',
    type_name: '电视剧',
    year: '2019',
    episodes: [1, 2, 46].map((ep) => `${site.api}/info/m3u8/1804/${ep}.m3u8`),
    episodes_titles: ['第1集', '第2集', '第46集'],
    desc: '少年范闲，\n前赴京都\n。',
    class: '剧情\n / \n古装',
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('剧集参数去重排序，非法路径参数不进入播放地址', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(
      detail(
        'tv',
        '1804',
        "'2','1','2','../key','https://other.test/a.m3u8','1080P'",
      ),
    ),
  );
  expect((await getDetailFromPpnix(site, 'tv-1804')).episodes_titles).toEqual([
    '第1集',
    '第2集',
  ]);
});

it('详情封面缺少 alt 时退回标题行', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(detail().replace(/ alt="[^"]*"/, '')),
  );
  expect((await getDetailFromPpnix(site, 'tv-1804')).title).toBe(
    '庆余年 第一季 Joy of Life',
  );
});

it('详情非四位年份使用 unknown', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response(detail().replace('(2019)', '(待定)')),
  );
  expect((await getDetailFromPpnix(site, 'tv-1804')).year).toBe('unknown');
});

it.each([
  '1804',
  'movie-0',
  'tv-01',
  'tv-../1',
  'tv-1?x=2',
  'TV-1',
  'movie-1.html',
  'movie-1\n',
])('详情编号严格白名单校验 %j', async (id) => {
  await expect(getDetailFromPpnix(site, id)).rejects.toThrow(
    '无效的 PPnix 作品编号',
  );
  expect(global.fetch).not.toHaveBeenCalled();
});

it.each([
  detail('tv', '1804', ''),
  detail('tv', '999'),
  detail('tv', '1804', "'javascript:alert(1)'"),
])('无有效播放参数或作品编号错配时抛错', async (html) => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(new Response(html));
  await expect(getDetailFromPpnix(site, 'tv-1804')).rejects.toThrow(
    'PPnix 暂无可播放剧集',
  );
});

it('详情结构无法识别时抛错', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    new Response('<html>维护中</html>'),
  );
  await expect(getDetailFromPpnix(site, 'tv-1804')).rejects.toThrow(
    'PPnix 详情页结构无法识别',
  );
});

it.each(['search', 'detail'])(
  '%s 非 2xx 响应取消正文并抛出状态码',
  async (stage) => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 503,
      body: { cancel },
    });
    await expect(
      stage === 'search'
        ? searchFromPpnix(site, 'test')
        : getDetailFromPpnix(site, 'tv-1804'),
    ).rejects.toThrow('PPnix请求失败 (503)');
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

it('资源限额原样抛出', async () => {
  const error = new ResourceLimitError();
  (global.fetch as jest.Mock).mockRejectedValueOnce(error);
  await expect(searchFromPpnix(site, 'test')).rejects.toBe(error);
});
