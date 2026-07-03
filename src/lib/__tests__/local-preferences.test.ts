import {
  DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY,
  ENABLE_OPTIMIZATION_STORAGE_KEY,
  FLUID_SEARCH_STORAGE_KEY,
  LIVE_DIRECT_CONNECT_STORAGE_KEY,
  readAggregateSearch,
  readEnableOptimization,
  readFluidSearch,
  readLiveDirectConnect,
  resetAggregateSearch,
  resetEnableOptimization,
  resetFluidSearch,
  resetLiveDirectConnect,
  writeAggregateSearch,
  writeEnableOptimization,
  writeFluidSearch,
  writeLiveDirectConnect,
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

  it('uses built-in default after aggregate reset', () => {
    writeAggregateSearch(false);
    resetAggregateSearch();

    expect(
      localStorage.getItem(DEFAULT_AGGREGATE_SEARCH_STORAGE_KEY),
    ).toBeNull();
    expect(readAggregateSearch()).toBe(true);
  });

  it('uses built-in default after optimization reset', () => {
    writeEnableOptimization(false);
    resetEnableOptimization();

    expect(localStorage.getItem(ENABLE_OPTIMIZATION_STORAGE_KEY)).toBeNull();
    expect(readEnableOptimization()).toBe(true);
  });

  it('uses built-in default after live direct connect reset', () => {
    writeLiveDirectConnect(true);
    resetLiveDirectConnect();

    expect(localStorage.getItem(LIVE_DIRECT_CONNECT_STORAGE_KEY)).toBeNull();
    expect(readLiveDirectConnect()).toBe(false);
  });
});
