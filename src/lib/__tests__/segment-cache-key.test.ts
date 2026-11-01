import { normalizeSegmentCacheKey } from '../segment-cache-key';

const SEGMENT_URL =
  'https://tv.example/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Fhls%2F0001.ts&icetv-source=demo';

describe('normalizeSegmentCacheKey', () => {
  it('drops per-manifest signature and switch params', () => {
    const first = `${SEGMENT_URL}&icetv-switch=initial&icetv-user-switch=0&icetv-expires=1700000000000&icetv-signature=${'a'.repeat(64)}`;
    const second = `${SEGMENT_URL}&icetv-switch=manual-source&icetv-user-switch=1&icetv-expires=1700000600000&icetv-signature=${'b'.repeat(64)}`;

    expect(normalizeSegmentCacheKey(first)).toBe(SEGMENT_URL);
    expect(normalizeSegmentCacheKey(second)).toBe(SEGMENT_URL);
  });

  it('keeps url, source and other params in their original encoding', () => {
    const base =
      'https://tv.example/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Fa%20b~(1).ts&icetv-source=demo&icetv-live=0';
    const signed = `https://tv.example/api/proxy/segment?icetv-expires=1&url=https%3A%2F%2Fcdn.example%2Fa%20b~(1).ts&icetv-signature=abc&icetv-source=demo&icetv-live=0#frag`;

    expect(normalizeSegmentCacheKey(signed)).toBe(base);
    expect(normalizeSegmentCacheKey(base)).toBe(base);
  });

  it('removes the query entirely when only volatile params remain', () => {
    expect(
      normalizeSegmentCacheKey(
        'https://tv.example/api/proxy/segment?icetv-expires=1&icetv-signature=abc',
      ),
    ).toBe('https://tv.example/api/proxy/segment');
  });

  it('returns the input unchanged when nothing is volatile', () => {
    expect(normalizeSegmentCacheKey(SEGMENT_URL)).toBe(SEGMENT_URL);
  });

  it('returns invalid or relative urls unchanged', () => {
    expect(normalizeSegmentCacheKey('not a url')).toBe('not a url');
    expect(
      normalizeSegmentCacheKey('/api/proxy/segment?url=a&icetv-expires=1'),
    ).toBe('/api/proxy/segment?url=a&icetv-expires=1');
  });
});
