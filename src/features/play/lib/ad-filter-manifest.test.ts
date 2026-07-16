import {
  parseDiscontinuitySegments,
  rebuildContinuousPlaylist,
  removeAdSegmentsKeepingDiscontinuities,
} from '@/features/play/lib/ad-filter-manifest';

const PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-DISCONTINUITY',
  '#EXTINF:5,',
  'main-a.ts',
  '#EXT-X-DISCONTINUITY',
  '#EXTINF:4,',
  'ad.ts',
  '#EXT-X-DISCONTINUITY',
  '#EXTINF:5,',
  'main-b.ts',
  '#EXT-X-ENDLIST',
].join('\n');

describe('ad-filter-manifest', () => {
  it('按时间轴边界解析媒体块', () => {
    const { segments } = parseDiscontinuitySegments(PLAYLIST);

    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.tsPaths)).toEqual([
      ['main-a.ts'],
      ['ad.ts'],
      ['main-b.ts'],
    ]);
    expect(segments.map((segment) => segment.duration)).toEqual([5, 4, 5]);
  });

  it('保留型重建只删除目标媒体块', () => {
    const { lines, segments } = parseDiscontinuitySegments(PLAYLIST);
    const result = removeAdSegmentsKeepingDiscontinuities(
      lines,
      segments,
      new Set([1]),
    );

    expect(result).not.toContain('ad.ts');
    expect(result).toContain('main-a.ts');
    expect(result).toContain('main-b.ts');
    expect(result.match(/#EXT-X-DISCONTINUITY/g)).toHaveLength(2);
  });

  it('连续型重建同时清理时间轴边界', () => {
    const { lines, segments } = parseDiscontinuitySegments(PLAYLIST);
    const result = rebuildContinuousPlaylist(lines, segments, new Set([1]));

    expect(result).not.toContain('ad.ts');
    expect(result).not.toContain('#EXT-X-DISCONTINUITY');
    expect(result.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });
});
