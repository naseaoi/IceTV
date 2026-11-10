import {
  AUTO_PLAY_NEXT_STORAGE_KEY,
  AUTO_SWITCH_SOURCE_STORAGE_KEY,
  BLOCK_AD_STORAGE_KEY,
  DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY,
  ENABLE_OPTIMIZATION_STORAGE_KEY,
  FLUID_SEARCH_STORAGE_KEY,
  LIVE_DIRECT_CONNECT_CHANGE_EVENT,
  LIVE_DIRECT_CONNECT_STORAGE_KEY,
  PREFERRED_QUALITY_STORAGE_KEY,
  readAggregateSearch,
  readAutoPlayNextEnabled,
  readAutoSwitchSource,
  readBlockAdEnabled,
  readContinueWatchingCount,
  readContinueWatchingPageCount,
  readDanmakuEpisodeSearchTitle,
  readEnableOptimization,
  readFluidSearch,
  readLiveDirectConnect,
  readPreferredQualityHeight,
  readPreferredQualityPreference,
  readSeenAnnouncement,
  readSourcePreferredQualityPreference,
  resetAggregateSearch,
  resetAutoSwitchSource,
  resetContinueWatchingCount,
  resetEnableOptimization,
  resetFluidSearch,
  resetLiveDirectConnect,
  SEEN_ANNOUNCEMENT_STORAGE_KEY,
  SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX,
  writeAggregateSearch,
  writeAutoPlayNextEnabled,
  writeAutoSwitchSource,
  writeBlockAdEnabled,
  writeContinueWatchingCount,
  writeContinueWatchingPageCount,
  writeDanmakuEpisodeId,
  writeDanmakuEpisodeSearchTitle,
  writeEnableOptimization,
  writeFluidSearch,
  writeLiveDirectConnect,
  writePreferredQualityHeight,
  writeSeenAnnouncement,
  writeSourcePreferredQualityHeight,
} from '../local-preferences';

describe('local preferences', () => {
  it('keeps full-page record counts separate and clears both counts on logout', () => {
    writeContinueWatchingCount(10);
    writeContinueWatchingPageCount(24);
    expect(readContinueWatchingCount()).toBe(10);
    expect(readContinueWatchingPageCount()).toBe(24);
    expect(document.cookie).toContain('cw_page_count=24');
    expect(document.cookie).toContain('cw_count=10');
    resetContinueWatchingCount();
    expect(readContinueWatchingCount()).toBe(0);
    expect(readContinueWatchingPageCount()).toBe(0);
    expect(document.cookie).not.toContain('cw_page_count=');
  });

  it('保存手动弹幕搜索词并随清除绑定重置', () => {
    const scopeKey = 'test:video:0';
    writeDanmakuEpisodeSearchTitle(scopeKey, ' 手动标题 ');
    expect(readDanmakuEpisodeSearchTitle(scopeKey)).toBe('手动标题');
    writeDanmakuEpisodeSearchTitle(scopeKey, '长'.repeat(81));
    expect(readDanmakuEpisodeSearchTitle(scopeKey)).toBe('手动标题');
    writeDanmakuEpisodeId(scopeKey, null);
    expect(readDanmakuEpisodeSearchTitle(scopeKey)).toBe('');
  });
  beforeEach(() => {
    localStorage.clear();
    delete window.RUNTIME_CONFIG;
  });

  it('uses runtime config for fluid search when no local override exists', () => {
    window.RUNTIME_CONFIG = {
      FLUID_SEARCH: false,
    } as typeof window.RUNTIME_CONFIG;

    expect(readFluidSearch()).toBe(false);
  });

  it('uses local fluid search override before runtime config', () => {
    window.RUNTIME_CONFIG = {
      FLUID_SEARCH: false,
    } as typeof window.RUNTIME_CONFIG;

    writeFluidSearch(true);

    expect(readFluidSearch()).toBe(true);
    expect(localStorage.getItem(FLUID_SEARCH_STORAGE_KEY)).toBe('true');
  });

  it('falls back to runtime config after fluid search reset', () => {
    window.RUNTIME_CONFIG = {
      FLUID_SEARCH: false,
    } as typeof window.RUNTIME_CONFIG;

    writeFluidSearch(true);
    resetFluidSearch();

    expect(localStorage.getItem(FLUID_SEARCH_STORAGE_KEY)).toBeNull();
    expect(readFluidSearch()).toBe(false);
  });

  it('falls back to runtime config after aggregate reset', () => {
    window.RUNTIME_CONFIG = {
      DEFAULT_AGGREGATE_SEARCH: false,
    } as typeof window.RUNTIME_CONFIG;

    writeAggregateSearch(false);
    resetAggregateSearch();

    expect(
      localStorage.getItem(DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY),
    ).toBeNull();
    expect(readAggregateSearch()).toBe(false);
  });

  it('falls back to runtime config after optimization reset', () => {
    window.RUNTIME_CONFIG = {
      ENABLE_OPTIMIZATION: false,
    } as typeof window.RUNTIME_CONFIG;

    writeEnableOptimization(false);
    resetEnableOptimization();

    expect(localStorage.getItem(ENABLE_OPTIMIZATION_STORAGE_KEY)).toBeNull();
    expect(readEnableOptimization()).toBe(false);
  });

  it('falls back to runtime config after live direct connect reset', () => {
    window.RUNTIME_CONFIG = {
      LIVE_DIRECT_CONNECT: true,
    } as typeof window.RUNTIME_CONFIG;

    writeLiveDirectConnect(true);
    resetLiveDirectConnect();

    expect(localStorage.getItem(LIVE_DIRECT_CONNECT_STORAGE_KEY)).toBeNull();
    expect(readLiveDirectConnect()).toBe(true);
  });

  it('notifies the current page when live direct connect changes', () => {
    const listener = jest.fn();
    window.addEventListener(LIVE_DIRECT_CONNECT_CHANGE_EVENT, listener);

    writeLiveDirectConnect(true);
    resetLiveDirectConnect();

    expect(listener).toHaveBeenCalledTimes(2);
    window.removeEventListener(LIVE_DIRECT_CONNECT_CHANGE_EVENT, listener);
  });

  it('keeps auto source switch off without a site default', () => {
    expect(readAutoSwitchSource()).toBe(false);
  });

  it('uses the site default for auto source switch until overridden', () => {
    window.RUNTIME_CONFIG = {
      AUTO_SWITCH_SOURCE: true,
    } as typeof window.RUNTIME_CONFIG;
    expect(readAutoSwitchSource()).toBe(true);

    writeAutoSwitchSource(false);
    expect(localStorage.getItem(AUTO_SWITCH_SOURCE_STORAGE_KEY)).toBe('false');
    expect(readAutoSwitchSource()).toBe(false);

    resetAutoSwitchSource();
    expect(localStorage.getItem(AUTO_SWITCH_SOURCE_STORAGE_KEY)).toBeNull();
    expect(readAutoSwitchSource()).toBe(true);
  });

  it('ignores the retired auto switch on timeout key', () => {
    localStorage.setItem('autoSwitchSourceOnTimeout', 'true');

    expect(AUTO_SWITCH_SOURCE_STORAGE_KEY).not.toBe(
      'autoSwitchSourceOnTimeout',
    );
    expect(readAutoSwitchSource()).toBe(false);
  });

  it('stores block ad preference through the shared helper', () => {
    expect(readBlockAdEnabled()).toBe(true);

    writeBlockAdEnabled(false);

    expect(localStorage.getItem(BLOCK_AD_STORAGE_KEY)).toBe('false');
    expect(readBlockAdEnabled()).toBe(false);
  });

  it('stores auto play next preference through the shared helper', () => {
    expect(readAutoPlayNextEnabled()).toBe(true);

    writeAutoPlayNextEnabled(false);

    expect(localStorage.getItem(AUTO_PLAY_NEXT_STORAGE_KEY)).toBe('false');
    expect(readAutoPlayNextEnabled()).toBe(false);
  });

  it('stores seen announcement through the shared helper', () => {
    writeSeenAnnouncement('notice-v1');

    expect(localStorage.getItem(SEEN_ANNOUNCEMENT_STORAGE_KEY)).toBe(
      'notice-v1',
    );
    expect(readSeenAnnouncement()).toBe('notice-v1');
  });

  it('stores and resets the continue watching count through the shared helper', () => {
    writeContinueWatchingCount(4.8);

    expect(readContinueWatchingCount()).toBe(4);
    expect(document.cookie).toContain('cw_count=4');

    resetContinueWatchingCount();

    expect(readContinueWatchingCount()).toBe(0);
    expect(document.cookie).not.toContain('cw_count=4');
  });

  it('distinguishes unset, auto, and manual quality preferences', () => {
    expect(readPreferredQualityPreference()).toEqual({ mode: 'default' });
    expect(readPreferredQualityHeight()).toBeNull();

    writePreferredQualityHeight(null);

    expect(localStorage.getItem(PREFERRED_QUALITY_STORAGE_KEY)).toBe('auto');
    expect(readPreferredQualityPreference()).toEqual({ mode: 'auto' });
    expect(readPreferredQualityHeight()).toBeNull();

    writePreferredQualityHeight(720);

    expect(localStorage.getItem(PREFERRED_QUALITY_STORAGE_KEY)).toBe('720');
    expect(readPreferredQualityPreference()).toEqual({
      mode: 'manual',
      height: 720,
    });
    expect(readPreferredQualityHeight()).toBe(720);
  });

  it('stores quality preferences independently for each source', () => {
    writeSourcePreferredQualityHeight('xigua', null);
    writeSourcePreferredQualityHeight('future_source', 1080);

    expect(
      localStorage.getItem(`${SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX}xigua`),
    ).toBe('auto');
    expect(readSourcePreferredQualityPreference('xigua')).toEqual({
      mode: 'auto',
    });
    expect(readSourcePreferredQualityPreference('future_source')).toEqual({
      mode: 'manual',
      height: 1080,
    });
  });

  it('uses the legacy preference only for xigua', () => {
    writePreferredQualityHeight(720);

    expect(readSourcePreferredQualityPreference('xigua')).toEqual({
      mode: 'manual',
      height: 720,
    });
    expect(readSourcePreferredQualityPreference('future_source')).toEqual({
      mode: 'default',
    });
  });

  it('ignores invalid source keys for quality preferences', () => {
    writeSourcePreferredQualityHeight('../xigua', 1080);

    expect(readSourcePreferredQualityPreference('../xigua')).toEqual({
      mode: 'default',
    });
    expect(localStorage.length).toBe(0);
  });
});

it('本地偏好写入受限时返回失败', () => {
  const spy = jest
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
  try {
    expect(writeAggregateSearch(false)).toBe(false);
  } finally {
    spy.mockRestore();
  }
});
