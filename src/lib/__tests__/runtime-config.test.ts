import {
  applyClientServerConfig,
  getCustomCategoryLabel,
} from '@/lib/runtime-config';

describe('runtime config', () => {
  afterEach(() => {
    delete window.RUNTIME_CONFIG;
    delete window.__runtimeConfigReady;
  });

  it('keeps configured numeric runtime values', () => {
    const config = applyClientServerConfig({
      VodPageTimeoutSeconds: 20,
      SourceFailureCooldownSeconds: 0,
    });

    expect(config.VOD_PAGE_TIMEOUT_SECONDS).toBe(20);
    expect(config.SOURCE_FAILURE_COOLDOWN_SECONDS).toBe(0);
    expect(window.RUNTIME_CONFIG).toEqual(config);
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
