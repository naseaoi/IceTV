import {
  getVodHlsBufferOverrides,
  getVodHlsLoadingOverrides,
  resolveVodM3U8ProxyTimeoutMs,
  resolveVodPlayerLoadingTimeoutSeconds,
  resolveVodSegmentProxyTimeoutMs,
} from '@/features/play/lib/vodSourcePlaybackPolicy';

describe('VOD source playback policy', () => {
  it('uses the xigua forward buffer observed on the source player', () => {
    expect(getVodHlsBufferOverrides('xigua')).toEqual({
      maxBufferLength: 120,
      maxMaxBufferLength: 300,
      maxBufferSize: 60 * 1000 * 1000,
    });
  });

  it('keeps other sources on shared buffer defaults', () => {
    expect(getVodHlsBufferOverrides('other')).toEqual({});
  });

  it('raises only the xigua segment proxy timeout floor', () => {
    expect(resolveVodSegmentProxyTimeoutMs('xigua', 15_000)).toBe(28_000);
    expect(resolveVodSegmentProxyTimeoutMs('xigua', 45_000)).toBe(45_000);
    expect(resolveVodSegmentProxyTimeoutMs('other', 15_000)).toBe(15_000);
  });

  it('raises xigua manifest and player loading timeouts', () => {
    expect(getVodHlsLoadingOverrides('xigua')).toEqual({
      manifestLoadingTimeOut: 30_000,
      levelLoadingTimeOut: 30_000,
    });
    expect(getVodHlsLoadingOverrides('other')).toEqual({});
    expect(resolveVodM3U8ProxyTimeoutMs('xigua', 15_000)).toBe(28_000);
    expect(resolveVodM3U8ProxyTimeoutMs('other', 15_000)).toBe(15_000);
    expect(resolveVodPlayerLoadingTimeoutSeconds('xigua', 15)).toBe(35);
    expect(resolveVodPlayerLoadingTimeoutSeconds('other', 15)).toBe(15);
  });
});
