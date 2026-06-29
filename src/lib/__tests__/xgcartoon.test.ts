import {
  buildXgcartoonPlaylistUrl,
  buildXgcartoonPlayUrl,
  buildXgcartoonVideoPath,
  buildXgcartoonVariantId,
  extractXgcartoonEpisodes,
  extractXgcartoonEpisodeVariants,
  extractXgcartoonPlayerVid,
  extractXgcartoonSearchResults,
  parseXgcartoonVariantId,
  parseXgcartoonDetailUrl,
} from '@/lib/xgcartoon';

const MOCK_DETAIL_HTML = `
<div>
  <a href="/user/page_direct?cartoon_id=heimaoyumonvdejiaoshiheimaohemonvdeketangriyu-houtenglv&amp;chapter_id=NQD9du24vz" title="第01话" rel="noopener" class="goto-chapter chapter-box text-truncate">
    <span>第01话</span>
  </a>
  <a href="/user/page_direct?cartoon_id=heimaoyumonvdejiaoshiheimaohemonvdeketangriyu-houtenglv&amp;chapter_id=JnNjH5zv7u" title="第02话" rel="noopener" class="goto-chapter chapter-box text-truncate">
    <span>第02话</span>
  </a>
  <a href="/user/page_direct?cartoon_id=heimaoyumonvdejiaoshiheimaohemonvdeketangriyu-houtenglv&amp;chapter_id=PLcsheT5Gg" title="第03话" rel="noopener" class="goto-chapter chapter-box text-truncate">
    <span>第03话</span>
  </a>
</div>
`;

describe('xgcartoon', () => {
  describe('parseXgcartoonDetailUrl', () => {
    it('提取详情页URL中的cartoonId', () => {
      const url =
        'https://www.xgcartoon.com/detail/heimaoyumonvdejiaoshiheimaohemonvdeketangriyu-houtenglv';
      const cartoonId = parseXgcartoonDetailUrl(url);
      expect(cartoonId).toBe(
        'heimaoyumonvdejiaoshiheimaohemonvdeketangriyu-houtenglv',
      );
    });

    it('URL不匹配时返回null', () => {
      const url = 'https://www.xgcartoon.com/';
      const cartoonId = parseXgcartoonDetailUrl(url);
      expect(cartoonId).toBeNull();
    });
  });

  describe('buildXgcartoonPlayUrl', () => {
    it('构建正确的播放页URL', () => {
      const url = buildXgcartoonPlayUrl('test-cartoon', 'abc123');
      expect(url).toBe(
        '/user/page_direct?cartoon_id=test-cartoon&chapter_id=abc123',
      );
    });
  });

  describe('buildXgcartoonVideoPath', () => {
    it('构建直接视频页路径', () => {
      const url = buildXgcartoonVideoPath('test-cartoon', 'abc123');
      expect(url).toBe('/video/test-cartoon/abc123.html');
    });
  });

  describe('extractXgcartoonEpisodes', () => {
    it('从HTML提取剧集列表', () => {
      const episodes = extractXgcartoonEpisodes(MOCK_DETAIL_HTML);

      expect(episodes).toHaveLength(3);
      expect(episodes[0]).toEqual({
        chapterId: 'NQD9du24vz',
        title: '第01话',
      });
      expect(episodes[1]).toEqual({
        chapterId: 'JnNjH5zv7u',
        title: '第02话',
      });
      expect(episodes[2]).toEqual({
        chapterId: 'PLcsheT5Gg',
        title: '第03话',
      });
    });

    it('HTML无剧集时返回空数组', () => {
      const episodes = extractXgcartoonEpisodes('<div>无内容</div>');
      expect(episodes).toEqual([]);
    });

    it('去重相同的chapterId', () => {
      const html = `
        <a href="/user/page_direct?cartoon_id=test&amp;chapter_id=abc123"><span>第01话</span></a>
        <a href="/user/page_direct?cartoon_id=test&amp;chapter_id=abc123"><span>第01话</span></a>
      `;
      const episodes = extractXgcartoonEpisodes(html);
      expect(episodes).toHaveLength(1);
    });

    it('优先提取选集区域的剧集链接', () => {
      const html = `
        <a href="/user/page_direct?cartoon_id=test&amp;chapter_id=first" class="btn btn-base"><span>播放</span></a>
        <a href="/user/page_direct?cartoon_id=test&amp;chapter_id=latest"><span>27</span></a>
        <div class="detail-right__volumes">
          <a href="/user/page_direct?cartoon_id=test&amp;chapter_id=first" title="第01集" class="goto-chapter chapter-box text-truncate"><span>第01集</span></a>
          <a href="/user/page_direct?cartoon_id=test&amp;chapter_id=second" title="第02集" class="goto-chapter chapter-box text-truncate"><span>第02集</span></a>
        </div>
      `;
      const episodes = extractXgcartoonEpisodes(html);

      expect(episodes).toEqual([
        { chapterId: 'first', title: '第01集' },
        { chapterId: 'second', title: '第02集' },
      ]);
    });
  });

  describe('extractXgcartoonPlayerVid', () => {
    it('从播放页iframe提取vid', () => {
      const html = `
        <iframe src="https://pframe.xgcartoon.com/player.htm?vid=ca4cb380-f955-412a-8891-02820f6b50a0&amp;autoplay=false"></iframe>
      `;

      expect(extractXgcartoonPlayerVid(html)).toBe(
        'ca4cb380-f955-412a-8891-02820f6b50a0',
      );
    });
  });

  describe('buildXgcartoonPlaylistUrl', () => {
    it('构建CDN播放列表URL', () => {
      expect(buildXgcartoonPlaylistUrl('ca4cb380-f955')).toBe(
        'https://xgct-video.bzcdn.net/ca4cb380-f955/playlist.m3u8',
      );
    });
  });

  describe('xgcartoon variant id', () => {
    it('构建和解析默认变体ID', () => {
      const id = buildXgcartoonVariantId('test-cartoon', '1', true);
      expect(id).toBe('test-cartoon');
      expect(parseXgcartoonVariantId(id)).toEqual({
        cartoonId: 'test-cartoon',
        groupId: null,
      });
    });

    it('构建和解析非默认变体ID', () => {
      const id = buildXgcartoonVariantId('test-cartoon', '2', false);
      expect(id).toBe('test-cartoon__xg_2');
      expect(parseXgcartoonVariantId(id)).toEqual({
        cartoonId: 'test-cartoon',
        groupId: '2',
      });
    });
  });

  describe('extractXgcartoonEpisodeVariants', () => {
    it('提取剧集变体', () => {
      const variants = extractXgcartoonEpisodeVariants(MOCK_DETAIL_HTML);

      expect(variants).toHaveLength(1);
      expect(variants[0]).toMatchObject({
        groupId: '1',
        label: '默认源',
        isDefault: true,
      });
      expect(variants[0].episodes).toHaveLength(3);
    });

    it('提取多季度分组', () => {
      const html = `
        <div>第1季【全26集】</div>
        <a href="/user/page_direct?cartoon_id=test&chapter_id=s1e1"><span>第01集</span></a>
        <a href="/user/page_direct?cartoon_id=test&chapter_id=s1e2"><span>第02集</span></a>
        <div>第2季【全27集】</div>
        <a href="/user/page_direct?cartoon_id=test&chapter_id=s2e1"><span>第01集</span></a>
        <a href="/user/page_direct?cartoon_id=test&chapter_id=s2e2"><span>第02集</span></a>
        <a href="/user/page_direct?cartoon_id=test&chapter_id=s2e3"><span>第03集</span></a>
      `;

      const variants = extractXgcartoonEpisodeVariants(html);

      expect(variants).toHaveLength(2);
      expect(variants[0].groupId).toBe('1');
      expect(variants[0].label).toBe('第1季【全26集】');
      expect(variants[0].episodes).toHaveLength(2);

      expect(variants[1].groupId).toBe('2');
      expect(variants[1].label).toBe('第2季【全27集】');
      expect(variants[1].episodes).toHaveLength(3);
    });

    it('无剧集时返回空数组', () => {
      const variants = extractXgcartoonEpisodeVariants('<div>无内容</div>');
      expect(variants).toEqual([]);
    });
  });

  describe('extractXgcartoonSearchResults', () => {
    it('从搜索页HTML提取动漫列表', () => {
      const html = `
        <a href="/detail/test-cartoon-1" target="_blank" class="topic-list-item">
          <amp-img src="https://static-a.xgcartoon.com/cover/test.jpg?w=300&h=256&q=100">
          <div class="topic-list-item--author">测试作者 [日本]</div>
          <div class="h3 mb12">测试动漫【日语】</div>
        </a>
        <a href="/detail/test-cartoon-2" target="_blank" class="topic-list-item">
          <amp-img src="https://static-a.xgcartoon.com/cover/test2.jpg">
          <div class="topic-list-item--author">作者2 [中国]</div>
          <div class="h3 mb12">动漫2【国语】</div>
        </a>
      `;

      const results = extractXgcartoonSearchResults(html);
      expect(results).toHaveLength(2);
      expect(results[0].cartoonId).toBe('test-cartoon-1');
      expect(results[0].title).toBe('测试动漫【日语】');
      expect(results[1].cartoonId).toBe('test-cartoon-2');
      expect(results[1].title).toBe('动漫2【国语】');
    });

    it('去重相同的cartoonId', () => {
      const html = `
        <a href="/detail/test-cartoon" class="topic-list-item">
          <amp-img src="test.jpg">
          <div class="h3">测试动漫</div>
        </a>
        <a href="/detail/test-cartoon" class="topic-list-item">
          <amp-img src="test.jpg">
          <div class="h3">测试动漫</div>
        </a>
      `;

      const results = extractXgcartoonSearchResults(html);
      expect(results).toHaveLength(1);
    });
  });
});
