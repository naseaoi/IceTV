import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import type { ApiSite } from '@/lib/config';
import {
  getDetailFromOlevod,
  isOlevodSource,
  searchFromOlevod,
} from '@/lib/downstream-sources/olevod';
import { ResourceLimitError } from '@/lib/server-resource-errors';

installStreamPolyfills();
const originalFetch = global.fetch;
const site: ApiSite = {
  key: 'olevod',
  name: '欧乐影院',
  api: 'https://www.olevod.com',
};
const item = {
  id: 55678,
  name: '庆余年 第二季',
  pic: 'upload/vod/20240516-1/ad91a3071d54b794207272fc5a4ff80b.jpg',
  picThumb: '',
  year: '2024',
  blurb: '<p>作品简介</p>',
  remarks: '完结',
  typeId1: 2,
};
const episode = {
  index: 1,
  title: '第01集',
  url: 'https://cloud.yuntongclouds.com/ts3/20240516/IcCsJxCd/mp4/IcCsJxCd.mp4/master.m3u8',
  vip: false,
};
const response = (data: unknown) => new Response(JSON.stringify(data));
const searchPayload = (list: unknown, total = 1) => ({
  code: 0,
  msg: 'ok',
  data: {
    total,
    data: [
      { type: 'vod', list, total },
      { type: 'tv', list: null },
    ],
  },
});
const detailPayload = (data: unknown) => ({ code: 0, msg: 'ok', data });

beforeEach(() => {
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it.each([
  ['https://olevod.com', true],
  ['https://www.olevod.com/path', true],
  ['https://sub.olevod.com', true],
  ['https://olevod.com.attacker.test', false],
  ['https://notolevod.com', false],
  ['https://cms.example/olevod.com?site=www.olevod.com', false],
  ['invalid', false],
])('识别只匹配主机名 %s', (api, expected) => {
  expect(isOlevodSource({ ...site, api })).toBe(expected);
});

it('每次请求重新签名，固定时间戳与实测成功的签名一致', async () => {
  // 此时间戳/签名对实测搜索返回 code=0，而非仅与另一份本地算法比较。
  const now = jest.spyOn(Date, 'now').mockReturnValue(1795879980000);
  (global.fetch as jest.Mock).mockImplementation(() =>
    Promise.resolve(response(searchPayload([]))),
  );
  await searchFromOlevod(site, '庆余年 /');
  const first = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
  expect(first.origin).toBe('https://api.olelive.com');
  expect(first.pathname).toBe(
    `/v1/pub/index/search/${encodeURIComponent('庆余年 /')}/vod/0/1/10`,
  );
  expect(first.searchParams.get('_vv')).toBe(
    '02e0ae31b21150d129e110fb37a3dcb4',
  );
  now.mockReturnValue(1795879981000);
  await searchFromOlevod(site, '庆余年 /');
  expect(
    new URL((global.fetch as jest.Mock).mock.calls[1][0]).searchParams.get(
      '_vv',
    ),
  ).not.toBe(first.searchParams.get('_vv'));
});

it('搜索映射相对封面、年份和完结状态，保留空剧集和缺失分类', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    response(searchPayload([null, item])),
  );
  await expect(searchFromOlevod(site, '庆余年')).resolves.toEqual([
    {
      id: '55678',
      title: item.name,
      poster: `https://static.olelive.com/${item.pic}`,
      episodes: [],
      episodes_titles: [],
      source: site.key,
      source_name: site.name,
      year: '2024',
      desc: '作品简介',
      type_name: '',
      class: '',
      series_status: 'ended',
      douban_id: 0,
    },
  ]);
});

it('搜索按 vip 字段过滤游客不可播条目，保留普通电影、剧集与超清画质', async () => {
  // 搜索与 /true 详情交叉验证的精简样本；前三项全部为空地址，后四项均有地址。
  const samples = [
    { id: 46008, name: '流浪地球2', typeId1: 6, vip: true, remarks: '超清' },
    {
      id: 45746,
      name: '阿凡达2：水之道',
      typeId1: 6,
      vip: true,
      remarks: '超清',
    },
    {
      id: 6795,
      name: '阿凡达【导演剪辑加长版】',
      typeId1: 6,
      vip: true,
      remarks: '超清',
    },
    { id: 42762, name: '流浪地球2', typeId1: 1, vip: false, remarks: '高清' },
    {
      id: 24144,
      name: '流浪地球2020特别版',
      typeId1: 1,
      vip: false,
      remarks: '高清',
    },
    {
      id: 55678,
      name: '庆余年 第二季',
      typeId1: 2,
      vip: false,
      remarks: '完结',
    },
    {
      id: 78535,
      name: '阿凡达：火与烬',
      typeId1: 1,
      vip: false,
      remarks: '超清',
    },
  ];
  (global.fetch as jest.Mock).mockResolvedValue(
    response(searchPayload(samples)),
  );
  expect(
    (await searchFromOlevod(site, '流浪地球')).map((result) => result.id),
  ).toEqual(['42762', '24144', '55678', '78535']);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('搜索仅有 VIP 条目时返回空结果', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    response(searchPayload([{ ...item, id: 46008, typeId1: 6, vip: true }])),
  );
  await expect(searchFromOlevod(site, '流浪地球')).resolves.toEqual([]);
});

it('年份不规范时返回 unknown，缩略图优先，未知状态保留未知', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    response(
      searchPayload([
        {
          ...item,
          year: '2024年',
          remarks: '',
          picThumb: 'upload/thumb.jpg',
        },
      ]),
    ),
  );
  expect((await searchFromOlevod(site, '庆余年'))[0]).toMatchObject({
    year: 'unknown',
    series_status: undefined,
    poster: 'https://static.olelive.com/upload/thumb.jpg',
  });
});

it.each([[], null])('真实零结果返回空数组 %j', async (list) => {
  (global.fetch as jest.Mock).mockResolvedValue(
    response(searchPayload(list, 0)),
  );
  await expect(searchFromOlevod(site, '不存在')).resolves.toEqual([]);
});

it.each([
  null,
  {},
  { code: 1, data: {} },
  searchPayload(null),
  searchPayload([null, {}, { ...item, id: 0 }, { ...item, name: ' ' }]),
])('无效搜索响应抛错 %j', async (payload) => {
  (global.fetch as jest.Mock).mockResolvedValue(response(payload));
  await expect(searchFromOlevod(site, '私密关键词')).rejects.toThrow(
    '欧乐搜索响应无效',
  );
});

it('详情直接返回媒体地址，过滤不可播放项并保留原始集号', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    response(
      detailPayload({
        ...item,
        content: '<p>完整简介</p>',
        typeId1Name: '连续剧',
        typeIdName: '国产剧',
        urls: [
          episode,
          null,
          { ...episode, index: 2, url: '' },
          { ...episode, index: 3, url: 'javascript:alert(1)' },
          { ...episode, index: 4, url: 'https://cdn.example/4.m3u8' },
        ],
      }),
    ),
  );
  const result = await getDetailFromOlevod(site, '55678');
  expect(result.episodes).toEqual([episode.url, 'https://cdn.example/4.m3u8']);
  expect(result.episodes_titles).toEqual(['第1集', '第4集']);
  expect(result).toMatchObject({ desc: '完整简介', type_name: '连续剧' });
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(
    '/detail/55678/true?_vv=',
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it.each([
  [1, '高清播放'],
  [1, ''],
  [6, '超清播放'],
  [6, ''],
])('电影分类 %s 保留原标题或使用正片：%s', async (typeId1, title) => {
  (global.fetch as jest.Mock).mockResolvedValue(
    response(
      detailPayload({
        ...item,
        typeId1,
        urls: [{ ...episode, title }],
      }),
    ),
  );
  expect((await getDetailFromOlevod(site, '55678')).episodes_titles).toEqual([
    title || '正片',
  ]);
});

it('游客 VIP 条目没有明文地址时抛出无可播放剧集', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    response(
      detailPayload({
        ...item,
        typeId1: 6,
        vip: true,
        urls: [{ index: 1, title: '超清播放', url: '', vip: true }],
      }),
    ),
  );
  await expect(getDetailFromOlevod(site, '55678')).rejects.toThrow(
    '欧乐暂无可播放剧集',
  );
});

it.each(['0', '-1', '01', '1.2', '1/true', '9007199254740992'])(
  '无效编号在回源前拒绝 %s',
  async (id) => {
    await expect(getDetailFromOlevod(site, id)).rejects.toThrow(
      '无效的欧乐编号',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

it.each([
  null,
  { code: 7, data: {} },
  detailPayload({ ...item, id: 2, urls: [episode] }),
  detailPayload(item),
])('无效详情抛错 %j', async (payload) => {
  (global.fetch as jest.Mock).mockResolvedValue(response(payload));
  await expect(getDetailFromOlevod(site, '55678')).rejects.toThrow(
    '欧乐详情响应无效',
  );
});

it('非 2xx 取消正文并保留状态码', async () => {
  const cancel = jest.fn().mockResolvedValue(undefined);
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 401,
    body: { cancel },
  });
  await expect(searchFromOlevod(site, '私密关键词')).rejects.toThrow(
    '欧乐请求失败 (401)',
  );
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('无效 JSON 使用安全错误文案', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    new Response('私密关键词 invalid json'),
  );
  await expect(searchFromOlevod(site, '私密关键词')).rejects.toThrow(
    '欧乐请求失败 (SyntaxError)',
  );
});

it('共享资源限额错误保持原对象', async () => {
  const error = new ResourceLimitError();
  (global.fetch as jest.Mock).mockRejectedValue(error);
  await expect(searchFromOlevod(site, '庆余年')).rejects.toBe(error);
});
