import {
  BLOCK_AD_STORAGE_KEY,
  DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY,
  ENABLE_OPTIMIZATION_STORAGE_KEY,
  FLUID_SEARCH_STORAGE_KEY,
  LIVE_DIRECT_CONNECT_STORAGE_KEY,
  readAggregateSearch,
  readBlockAdEnabled,
  readEnableOptimization,
  readFluidSearch,
  readLiveDirectConnect,
  readSeenAnnouncement,
  readSidebarCollapsed,
  resetAggregateSearch,
  resetEnableOptimization,
  resetFluidSearch,
  resetLiveDirectConnect,
  SEEN_ANNOUNCEMENT_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  writeAggregateSearch,
  writeBlockAdEnabled,
  writeEnableOptimization,
  writeFluidSearch,
  writeLiveDirectConnect,
  writeSeenAnnouncement,
  writeSidebarCollapsed,
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
});
