import {
  ADMIN_TABLE_COLUMN_WIDTHS_STORAGE_KEY,
  BLOCK_AD_STORAGE_KEY,
  DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY,
  ENABLE_OPTIMIZATION_STORAGE_KEY,
  FLUID_SEARCH_STORAGE_KEY,
  LIVE_DIRECT_CONNECT_STORAGE_KEY,
  PREFERRED_QUALITY_STORAGE_KEY,
  readAdminTableColumnWidth,
  readAggregateSearch,
  readBlockAdEnabled,
  readEnableOptimization,
  readFluidSearch,
  readLiveDirectConnect,
  readPreferredQualityHeight,
  readPreferredQualityPreference,
  readSeenAnnouncement,
  readSidebarCollapsed,
  readSourcePreferredQualityPreference,
  resetAggregateSearch,
  resetEnableOptimization,
  resetFluidSearch,
  resetLiveDirectConnect,
  SEEN_ANNOUNCEMENT_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SOURCE_PREFERRED_QUALITY_STORAGE_PREFIX,
  writeAdminTableColumnWidth,
  writeAggregateSearch,
  writeBlockAdEnabled,
  writeEnableOptimization,
  writeFluidSearch,
  writeLiveDirectConnect,
  writePreferredQualityHeight,
  writeSeenAnnouncement,
  writeSidebarCollapsed,
  writeSourcePreferredQualityHeight,
} from '../local-preferences';

describe('local preferences', () => {
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

  it('stores block ad preference through the shared helper', () => {
    expect(readBlockAdEnabled()).toBe(true);

    writeBlockAdEnabled(false);

    expect(localStorage.getItem(BLOCK_AD_STORAGE_KEY)).toBe('false');
    expect(readBlockAdEnabled()).toBe(false);
  });

  it('stores sidebar collapsed preference through the shared helper', () => {
    expect(readSidebarCollapsed()).toBe(false);

    writeSidebarCollapsed(true);

    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true');
    expect(readSidebarCollapsed()).toBe(true);
  });

  it('stores seen announcement through the shared helper', () => {
    writeSeenAnnouncement('notice-v1');

    expect(localStorage.getItem(SEEN_ANNOUNCEMENT_STORAGE_KEY)).toBe(
      'notice-v1',
    );
    expect(readSeenAnnouncement()).toBe('notice-v1');
  });

  it('stores admin table column widths independently', () => {
    writeAdminTableColumnWidth('source-list', 'name', 220.4);
    writeAdminTableColumnWidth('source-list', 'api', 360);
    writeAdminTableColumnWidth('user-list', 'name', 180);

    expect(readAdminTableColumnWidth('source-list', 'name')).toBe(220);
    expect(readAdminTableColumnWidth('source-list', 'api')).toBe(360);
    expect(readAdminTableColumnWidth('user-list', 'name')).toBe(180);
  });

  it('ignores invalid admin table column width preferences', () => {
    localStorage.setItem(
      ADMIN_TABLE_COLUMN_WIDTHS_STORAGE_KEY,
      JSON.stringify({
        'source-list': {
          name: 20,
          api: '360',
          status: 120,
        },
        '../unsafe': { name: 200 },
      }),
    );

    expect(readAdminTableColumnWidth('source-list', 'name')).toBeUndefined();
    expect(readAdminTableColumnWidth('source-list', 'api')).toBeUndefined();
    expect(readAdminTableColumnWidth('source-list', 'status')).toBe(120);
    expect(readAdminTableColumnWidth('../unsafe', 'name')).toBeUndefined();

    writeAdminTableColumnWidth('source-list', 'name', Number.NaN);
    expect(readAdminTableColumnWidth('source-list', 'name')).toBeUndefined();
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
