import type { ApiSite } from '@/lib/config';
import { getDetailFromApi, searchFirstPageFromApi } from '@/lib/downstream';
import { resolveXgcartoonEpisodeUrlByPath } from '@/lib/downstream-sources/xgcartoon';

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

  it('详情只抓详情页并按结构返回懒地址与分组计数', async () => {
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

    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://www.xgcartoon.com/detail/test-cartoon') {
        return createTextResponse(detailHtml);
      }
      return createTextResponse('', false);
    });

    const detail = await getDetailFromApi(
      createXgcartoonSite(),
      'test-cartoon',
    );
    const urls = fetchMock.mock.calls.map(([input]) => String(input));

    expect(urls).toEqual(['https://www.xgcartoon.com/detail/test-cartoon']);
    expect(detail).toEqual(
      expect.objectContaining({
        id: 'test-cartoon',
        title: '测试动漫',
        poster:
          'https://static-a.xgcartoon.com/cover/test-cartoon.jpg?w=230&h=280',
        episodes: [
          'icetv-lazy://xgcartoon/video/test-cartoon/c1.html',
          'icetv-lazy://xgcartoon/video/test-cartoon/c2.html',
          'icetv-lazy://xgcartoon/video/test-cartoon/c3.html',
        ],
        episodes_titles: ['第01集', '第02集', '第01集'],
        episode_groups: [
          { label: '第1季【全2集】', count: 2 },
          { label: '第2季【全1集】', count: 1 },
        ],
        class: '动作',
        desc: '测试简介',
      }),
    );
    expect(detail.related_sources).toBeUndefined();
  });

  it('resolveXgcartoonEpisodeUrlByPath 解析播放页并拼出 CDN 地址', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/video\/test-cartoon\/c1\.html$/.test(url)) {
        return createTextResponse(
          '<iframe src="https://pframe.xgcartoon.com/player.htm?vid=11111111-1111-4111-8111-111111111111&amp;autoplay=false"></iframe>',
        );
      }
      return createTextResponse('', false);
    });

    await expect(
      resolveXgcartoonEpisodeUrlByPath(
        createXgcartoonSite(),
        '/video/test-cartoon/c1.html',
      ),
    ).resolves.toBe(
      'https://xgct-video.bzcdn.net/11111111-1111-4111-8111-111111111111/playlist.m3u8',
    );
  });

  it('携带旧版 __xg_ 后缀ID时仍返回合并后的完整剧集', async () => {
    const detailHtml = `
      <html>
        <div class="detail-right__title"><h1>测试动漫</h1></div>
        <div class="detail-right__volumes">
          <div class="col-12 volume-title">第1季【全1集】</div>
          <a href="/user/page_direct?cartoon_id=test-cartoon&amp;chapter_id=c1" title="第01集" class="goto-chapter chapter-box text-truncate"><span>第01集</span></a>
          <div class="col-12 volume-title">第2季【全1集】</div>
          <a href="/user/page_direct?cartoon_id=test-cartoon&amp;chapter_id=c2" title="第01集" class="goto-chapter chapter-box text-truncate"><span>第01集</span></a>
        </div>
      </html>
    `;
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://www.xgcartoon.com/detail/test-cartoon') {
        return createTextResponse(detailHtml);
      }
      return createTextResponse('', false);
    });

    const detail = await getDetailFromApi(
      createXgcartoonSite(),
      'test-cartoon__xg_2',
    );

    expect(detail.id).toBe('test-cartoon');
    expect(detail.episodes).toEqual([
      'icetv-lazy://xgcartoon/video/test-cartoon/c1.html',
      'icetv-lazy://xgcartoon/video/test-cartoon/c2.html',
    ]);
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
