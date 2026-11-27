import Artplayer from 'artplayer';
import { Converter } from 'opencc-js/cn2t';

import { type DisplayTextGlobals } from '@/lib/display-text';
import {
  createArtPlayerConfig,
  createHlsConfig,
  ensureVideoSource,
  showTimedArtNotice,
} from '@/lib/player-utils';

function sourceUrls(video: HTMLVideoElement) {
  return Array.from(video.getElementsByTagName('source')).map((s) => s.src);
}

describe('ensureVideoSource', () => {
  it('保留 hls.js 的 blob 媒体源在最前，播放地址只作为末尾备选', () => {
    const video = document.createElement('video');
    const mediaSource = document.createElement('source');
    mediaSource.src = 'blob:http://localhost/media-source';
    video.appendChild(mediaSource);

    ensureVideoSource(video, 'http://localhost/a.m3u8');
    ensureVideoSource(video, 'http://localhost/b.m3u8');

    expect(sourceUrls(video)).toEqual([
      'blob:http://localhost/media-source',
      'http://localhost/b.m3u8',
    ]);
    expect(video.disableRemotePlayback).toBe(false);
  });

  it('没有 blob 媒体源时只保留一个当前地址', () => {
    const video = document.createElement('video');

    ensureVideoSource(video, 'http://localhost/a.mp4');
    ensureVideoSource(video, 'http://localhost/a.mp4');

    expect(sourceUrls(video)).toEqual(['http://localhost/a.mp4']);
  });
});

describe('createHlsConfig', () => {
  it('关闭插播控制器，避免挂载媒体时重复 startLoad 中止续播首片', () => {
    expect(createHlsConfig().enableInterstitialPlayback).toBe(false);
  });
});

describe('播放器显示语言', () => {
  const globals = globalThis as DisplayTextGlobals;
  beforeEach(() => {
    // Artplayer 销毁时调用 video.load()，jsdom 未实现
    jest
      .spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    document.documentElement.lang = '';
    delete globals.__ICETV_DISPLAY_CONVERTER__;
  });

  it.each([
    ['zh-TW', 'twp', '顯示設定'],
    ['zh-HK', 'hk', '顯示設置'],
  ] as const)(
    '%s 注册完整字典且只转换字典值',
    (language, variant, showSetting) => {
      document.documentElement.lang = language;
      globals.__ICETV_DISPLAY_CONVERTER__ = Converter({
        from: 'cn',
        to: variant,
      });
      const container = document.createElement('div');
      document.body.appendChild(container);
      const player = new Artplayer({ container, url: '', lang: 'zh-cn' });
      const zhCn = player.i18n.languages['zh-cn']!;
      try {
        for (const isLive of [false, true]) {
          const config = createArtPlayerConfig({ isLive });
          const dictionary = config.i18n?.[config.lang];
          expect(config.lang).toBe(language.toLowerCase());
          expect(Object.keys(dictionary ?? {})).toEqual(Object.keys(zhCn));
          expect(dictionary?.['Show Setting']).toBe(showSetting);
          expect(dictionary?.['Video Load Failed']).toBe(
            language === 'zh-TW' ? '載入失敗' : '加載失敗',
          );
        }
        expect(zhCn['Show Setting']).toBe('显示设置');
      } finally {
        player.destroy();
        container.remove();
      }
    },
  );

  it('简体使用内置字典，notice 只在写入时转换并恢复时长', () => {
    document.documentElement.lang = 'zh-CN';
    expect(createArtPlayerConfig()).toMatchObject({ lang: 'zh-cn' });
    expect(createArtPlayerConfig().i18n).toBeUndefined();
    document.documentElement.lang = 'zh-TW';
    globals.__ICETV_DISPLAY_CONVERTER__ = Converter({ from: 'cn', to: 'twp' });
    const constructor = Object.assign(function Player() {}, {
      NOTICE_TIME: 2000,
    });
    const player = { constructor, notice: { show: '' } };
    showTimedArtNotice(player, '设置', 4000);
    expect(player.notice.show).toBe('設定');
    expect(constructor.NOTICE_TIME).toBe(2000);
  });
});
