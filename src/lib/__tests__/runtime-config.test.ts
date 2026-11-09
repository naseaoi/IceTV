import {
  applyClientServerConfig,
  DEFAULT_RUNTIME_CONFIG,
  getClientAuthRuntimeConfig,
  getCustomCategoryLabel,
} from '@/lib/runtime-config';

describe('runtime config', () => {
  afterEach(() => {
    delete window.RUNTIME_CONFIG;
    delete window.__runtimeConfigReady;
  });

  it('LinuxDo 开关默认关闭并通过运行时配置读取，无首屏请求', async () => {
    expect(DEFAULT_RUNTIME_CONFIG.LINUXDO_LOGIN).toBe(false);
    applyClientServerConfig({ LinuxDoLogin: true });
    expect((await getClientAuthRuntimeConfig()).linuxDoLogin).toBe(true);
    applyClientServerConfig({});
    expect((await getClientAuthRuntimeConfig()).linuxDoLogin).toBe(false);
  });

  it('keeps the server-only filter flag out of client runtime config', () => {
    const payload = { SiteName: 'IceTV', DisableYellowFilter: true };

    expect(DEFAULT_RUNTIME_CONFIG).not.toHaveProperty('DISABLE_YELLOW_FILTER');
    expect(applyClientServerConfig(payload)).not.toHaveProperty(
      'DISABLE_YELLOW_FILTER',
    );
  });

  it('preserves client custom proxy URLs', () => {
    const config = applyClientServerConfig({
      DoubanProxy: 'https://data.example/fetch?url=',
      DoubanImageProxy: 'https://image.example/fetch?url=',
    });

    expect(config.DOUBAN_PROXY).toBe('https://data.example/fetch?url=');
    expect(config.DOUBAN_IMAGE_PROXY).toBe('https://image.example/fetch?url=');
  });

  it('defaults user danmaku off and maps the server switch', () => {
    expect(DEFAULT_RUNTIME_CONFIG.ENABLE_USER_DANMAKU).toBe(false);
    expect(applyClientServerConfig({}).ENABLE_USER_DANMAKU).toBe(false);
    expect(
      applyClientServerConfig({ EnableUserDanmaku: true }).ENABLE_USER_DANMAKU,
    ).toBe(true);
  });

  it('keeps configured numeric runtime values', () => {
    const config = applyClientServerConfig({
      VodPageTimeoutSeconds: 20,
      VodFragmentTimeoutSeconds: 25,
      ContinueWatchingLimit: 0,
    });

    expect(config.VOD_PAGE_TIMEOUT_SECONDS).toBe(20);
    expect(config.VOD_FRAGMENT_TIMEOUT_SECONDS).toBe(25);
    expect(config.CONTINUE_WATCHING_LIMIT).toBe(0);
    expect(window.RUNTIME_CONFIG).toEqual(config);
  });

  it('falls back to playback defaults for older server payloads', () => {
    const config = applyClientServerConfig({});

    expect(config.VOD_FRAGMENT_TIMEOUT_SECONDS).toBe(10);
    expect(config.AUTO_SWITCH_SOURCE).toBe(false);
  });

  it('keeps the configured auto source switch default', () => {
    expect(
      applyClientServerConfig({ AutoSwitchSource: true }).AUTO_SWITCH_SOURCE,
    ).toBe(true);
  });

  it('uses the first configured category name as the custom entry label', () => {
    const config = applyClientServerConfig({
      CustomCategories: [
        { name: ' test ', type: 'movie', query: 'test' },
        { name: '剧集', type: 'tv', query: '剧集' },
      ],
    });

    expect(getCustomCategoryLabel(config)).toBe('test');
    expect(getCustomCategoryLabel()).toBe('自定义');
  });
});
