import {
  buildGirigiriVariantId,
  countGirigiriVariantTabs,
  extractGirigiriEpisodeEntries,
  extractGirigiriEpisodeVariants,
  parseGirigiriVariantId,
} from '@/lib/giri';

import { createGiriTrackingHtml } from './__fixtures__/giri-tracking';

describe('extractGirigiriEpisodeEntries', () => {
  it('只保留源站默认的第一组播放列表，避免不同版本混在一起', () => {
    const html = `
      <div class="anthology">
        <div class="anthology-list-box none">
          <div>
            <ul class="anthology-list-play size">
              <li><a href="/playGV123-1-1/">01</a></li>
              <li><a href="/playGV123-1-2/">02</a></li>
            </ul>
          </div>
        </div>
        <div class="anthology-list-box none">
          <div>
            <ul class="anthology-list-play size">
              <li><a href="/playGV123-2-1/">01</a></li>
              <li><a href="/playGV123-2-2/">02</a></li>
            </ul>
          </div>
        </div>
      </div>
    `;

    expect(extractGirigiriEpisodeEntries(html)).toEqual([
      { playPath: '/playGV123-1-1/', title: '01' },
      { playPath: '/playGV123-1-2/', title: '02' },
    ]);
  });

  it('会对同一播放地址去重', () => {
    const html = `
      <ul>
        <li><a href="/playGV123-1-1/">01</a></li>
        <li><a href="/playGV123-1-1/">01</a></li>
        <li><a href="/playGV123-1-2/">02</a></li>
      </ul>
    `;

    expect(extractGirigiriEpisodeEntries(html)).toEqual([
      { playPath: '/playGV123-1-1/', title: '01' },
      { playPath: '/playGV123-1-2/', title: '02' },
    ]);
  });
});

describe('girigiri variant helpers', () => {
  it('默认版本保留原始 id，非默认版本拼接 groupId', () => {
    expect(buildGirigiriVariantId('123', '1', true)).toBe('123');
    expect(buildGirigiriVariantId('123', '2', false)).toBe('123__giri_2');
  });

  it('能解析复合版本 id', () => {
    expect(parseGirigiriVariantId('123')).toEqual({
      videoId: '123',
      groupId: null,
    });
    expect(parseGirigiriVariantId('123__giri_2')).toEqual({
      videoId: '123',
      groupId: '2',
    });
  });
});

describe('extractGirigiriEpisodeVariants', () => {
  it.each([8, 9])('集数角标为 %i 时仍使用稳定的分组标签', (count) => {
    const variants = extractGirigiriEpisodeVariants(
      createGiriTrackingHtml(count, count),
    );

    expect(variants.map((variant) => variant.label)).toEqual(['繁中', '简中']);
    expect(variants.map((variant) => variant.episodes.length)).toEqual([
      count,
      count,
    ]);
  });

  it('只移除角标，不移除版本名称中的数字', () => {
    const html = createGiriTrackingHtml(2, 2)
      .replace('繁中', '线路 2')
      .replace('简中', '1080P');

    expect(
      extractGirigiriEpisodeVariants(html).map((variant) => variant.label),
    ).toEqual(['线路 2', '1080P']);
  });

  it('按 group 提取多个版本并保留 tab 标签', () => {
    const html = `
      <div class="anthology-tab swiper-container"><div class="swiper-wrapper">
        <a>繁中</a>
        <a>简中</a>
      </div></div>
      <div class="anthology">
        <div class="anthology-list-box none">
          <ul class="anthology-list-play size">
            <li><a href="/playGV123-1-1/">01</a></li>
            <li><a href="/playGV123-1-2/">02</a></li>
          </ul>
        </div>
        <div class="anthology-list-box none">
          <ul class="anthology-list-play size">
            <li><a href="/playGV123-2-1/">01</a></li>
            <li><a href="/playGV123-2-2/">02</a></li>
          </ul>
        </div>
      </div>
    `;

    expect(extractGirigiriEpisodeVariants(html)).toEqual([
      {
        groupId: '1',
        label: '繁中',
        isDefault: true,
        episodes: [
          { playPath: '/playGV123-1-1/', title: '01' },
          { playPath: '/playGV123-1-2/', title: '02' },
        ],
      },
      {
        groupId: '2',
        label: '简中',
        isDefault: false,
        episodes: [
          { playPath: '/playGV123-2-1/', title: '01' },
          { playPath: '/playGV123-2-2/', title: '02' },
        ],
      },
    ]);
  });

  it('会解码版本标签里的 HTML 实体', () => {
    const html = `
      <div class="anthology-tab swiper-container"><div class="swiper-wrapper">
        <a>&amp;nbsp;简中 10</a>
        <a>&nbsp;繁中 11</a>
      </div></div>
      <div class="anthology">
        <div class="anthology-list-box none">
          <ul class="anthology-list-play size">
            <li><a href="/playGV123-1-1/">01</a></li>
          </ul>
        </div>
        <div class="anthology-list-box none">
          <ul class="anthology-list-play size">
            <li><a href="/playGV123-2-1/">01</a></li>
          </ul>
        </div>
      </div>
    `;

    expect(
      extractGirigiriEpisodeVariants(html).map((item) => item.label),
    ).toEqual(['简中 10', '繁中 11']);
  });

  it('tab 条里嵌套 swiper-slide div 时仍能提取每个版本的标签', () => {
    const html = `
      <div class="anthology">
        <div class="anthology-tab swiper-container">
          <div class="swiper-wrapper">
            <div class="swiper-slide"><a>繁中</a></div>
            <div class="swiper-slide"><a>简中</a></div>
            <div class="swiper-slide"><a>日语</a></div>
          </div>
        </div>
        <div class="anthology-list-box none">
          <ul class="anthology-list-play size">
            <li><a href="/playGV123-1-1/">01</a></li>
          </ul>
        </div>
        <div class="anthology-list-box none">
          <ul class="anthology-list-play size">
            <li><a href="/playGV123-2-1/">01</a></li>
          </ul>
        </div>
        <div class="anthology-list-box none">
          <ul class="anthology-list-play size">
            <li><a href="/playGV123-3-1/">01</a></li>
          </ul>
        </div>
      </div>
    `;

    expect(
      extractGirigiriEpisodeVariants(html).map((item) => item.label),
    ).toEqual(['繁中', '简中', '日语']);
  });
});

describe('countGirigiriVariantTabs', () => {
  it('无 tab 条时返回 0', () => {
    expect(countGirigiriVariantTabs('<div>other</div>')).toBe(0);
  });

  it('能数出嵌套 swiper-slide 中的 tab 数量', () => {
    const html = `
      <div class="anthology">
        <div class="anthology-tab swiper-container">
          <div class="swiper-wrapper">
            <div class="swiper-slide"><a>繁中</a></div>
            <div class="swiper-slide"><a>简中</a></div>
          </div>
        </div>
        <div class="anthology-list-box none"></div>
      </div>
    `;
    expect(countGirigiriVariantTabs(html)).toBe(2);
  });
});
