import { describe, expect, it } from 'vitest';

import {
  buildXgcartoonPlayUrl,
  extractXgcartoonEpisodes,
  extractXgcartoonEpisodeVariants,
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

    it('无剧集时返回空数组', () => {
      const variants = extractXgcartoonEpisodeVariants('<div>无内容</div>');
      expect(variants).toEqual([]);
    });
  });
});
