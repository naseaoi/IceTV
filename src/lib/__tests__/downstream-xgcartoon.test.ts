import type { ApiSite } from '@/lib/config';
import { getDetailFromApi, searchFirstPageFromApi } from '@/lib/downstream';

const originalFetch = global.fetch;

function createTextResponse(data: string, ok = true): Response {
  return {
    ok,
    url: '',
    text: async () => data,
  } as Response;
}

function createXgcartoonSite(api = 'https://www.xgcartoon.com'): ApiSite {
  return {
    key: 'xigua',
    name: '西瓜卡通',
    api,
  };
}

describe('downstream xgcartoon source', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('详情会解析播放页iframe并返回m3u8地址', async () => {
    const detailHtml = `
      <html>
        <div class="detail-sider">
          <amp-img src="https://static-a.xgcartoon.com/cover/test-cartoon.jpg?w=230&amp;h=280"></amp-img>
          <a href="/user/page_direct?cartoon_id=test-cartoon&amp;chapter_id=c1" class="btn btn-base"><span>播放</span></a>
          <a href="/user/page_direct?cartoon_id=test-cartoon&amp;chapter_id=latest"><span>27</span></a>
        </div>
        <div class="detail-right__title"><h1>测试动漫</h1></div>
        <div class="tag tag-secondary">动作</div>
        <div class="detail-right__desc mt42"><p>测试简介</p></div>
        <div class="detail-right__volumes">
          <div class="col-12 volume-title">第1季【全2集】</div>
          <a href="/user/page_direct?cartoon_id=test-cartoon&amp;chapter_id=c1" title="第01集" class="goto-chapter chapter-box text-truncate"><span>第01集</span></a>
          <a href="/user/page_direct?cartoon_id=test-cartoon&amp;chapter_id=c2" title="第02集" class="goto-chapter chapter-box text-truncate"><span>第02集</span></a>
          <div class="col-12 volume-title">第2季【全1集】</div>
          <a href="/user/page_direct?cartoon_id=test-cartoon&amp;chapter_id=c3" title="第01集" class="goto-chapter chapter-box text-truncate"><span>第01集</span></a>
        </div>
      </html>
    `;
    const playHtmlByChapter: Record<string, string> = {
      c1: '<iframe src="https://pframe.xgcartoon.com/player.htm?vid=11111111-1111-4111-8111-111111111111&amp;autoplay=false"></iframe>',
      c2: '<iframe src="https://pframe.xgcartoon.com/player.htm?vid=22222222-2222-4222-8222-222222222222&amp;autoplay=false"></iframe>',
      c3: '<iframe src="https://pframe.xgcartoon.com/player.htm?vid=33333333-3333-4333-8333-333333333333&amp;autoplay=false"></iframe>',
    };

    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://www.xgcartoon.com/detail/test-cartoon') {
        return createTextResponse(detailHtml);
      }

      const chapterId =
        url.match(/\/video\/test-cartoon\/([^/]+)\.html/)?.[1] || '';
      return createTextResponse(playHtmlByChapter[chapterId] || '', true);
    });

    const detail = await getDetailFromApi(
      createXgcartoonSite(),
      'test-cartoon',
    );

    expect(detail).toEqual(
      expect.objectContaining({
        id: 'test-cartoon',
        title: '测试动漫',
        poster:
          'https://static-a.xgcartoon.com/cover/test-cartoon.jpg?w=230&h=280',
        episodes: [
          'https://xgct-video.bzcdn.net/11111111-1111-4111-8111-111111111111/playlist.m3u8',
          'https://xgct-video.bzcdn.net/22222222-2222-4222-8222-222222222222/playlist.m3u8',
        ],
        episodes_titles: ['第01集', '第02集'],
        class: '动作',
        desc: '测试简介',
      }),
    );
    expect(detail.related_sources?.[0]).toEqual(
      expect.objectContaining({
        id: 'test-cartoon__xg_2',
        episodes: [],
        episodes_titles: ['第01集'],
      }),
    );
  });

  it('搜索会过滤标题无关结果', async () => {
    const searchHtml = `
      <a href="/detail/busan-1" target="_blank" class="topic-list-item">
        <amp-img src="/cover/busan.jpg"></amp-img>
        <div class="topic-list-item--author">作者 [韩国]</div>
        <div class="h3 mb12">釜山行【韩语】</div>
      </a>
      <a href="/detail/seoul-station" target="_blank" class="topic-list-item">
        <amp-img src="/cover/seoul.jpg"></amp-img>
        <div class="topic-list-item--author">作者 [韩国]</div>
        <div class="h3 mb12">首尔站（釜山行前传）【韩语】</div>
      </a>
      <a href="/detail/unrelated" target="_blank" class="topic-list-item">
        <amp-img src="/cover/unrelated.jpg"></amp-img>
        <div class="topic-list-item--author">作者 [日本]</div>
        <div class="h3 mb12">完全无关的动画</div>
      </a>
    `;
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(createTextResponse(searchHtml));

    const results = await searchFirstPageFromApi(
      createXgcartoonSite(),
      '《釜山行》',
    );

    expect(results.map((item) => item.title)).toEqual([
      '釜山行【韩语】',
      '首尔站（釜山行前传）【韩语】',
    ]);
  });

  it('搜索无标题命中时返回空结果', async () => {
    const searchHtml = `
      <a href="/detail/fog-hill" target="_blank" class="topic-list-item">
        <amp-img src="/cover/fog.jpg"></amp-img>
        <div class="topic-list-item--author">作者 [国漫]</div>
        <div class="h3 mb12">雾山五行【国语】</div>
      </a>
      <a href="/detail/unrelated" target="_blank" class="topic-list-item">
        <amp-img src="/cover/unrelated.jpg"></amp-img>
        <div class="topic-list-item--author">作者 [日本]</div>
        <div class="h3 mb12">完全无关的动画</div>
      </a>
    `;
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue(createTextResponse(searchHtml));

    const results = await searchFirstPageFromApi(
      createXgcartoonSite(),
      '釜山行',
    );

    expect(results).toEqual([]);
  });
});
