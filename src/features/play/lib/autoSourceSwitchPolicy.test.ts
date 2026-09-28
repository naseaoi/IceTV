import type { VideoQualityInfo } from '@/features/play/hooks/usePlayPageState';
import {
  buildAutoSwitchSourceKey,
  parseLoadSpeedKBps,
  rankAutoSwitchCandidates,
  selectAutoSwitchCandidates,
} from '@/features/play/lib/autoSourceSwitchPolicy';
import type { SourcePlaybackStat } from '@/lib/source-playback-stats';
import type { SearchResult } from '@/lib/types';

function createSource(
  source: string,
  episodeTitles: string[],
  overrides: Partial<SearchResult> = {},
): SearchResult {
  return {
    id: `${source}-id`,
    title: '测试剧',
    poster: '',
    episodes: episodeTitles.map(
      (_, index) => `https://${source}/${index}.m3u8`,
    ),
    episodes_titles: episodeTitles,
    source,
    source_name: source.toUpperCase(),
    year: '2024',
    ...overrides,
  };
}

function info(
  loadSpeed: string,
  overrides: Partial<VideoQualityInfo> = {},
): VideoQualityInfo {
  return { quality: '1080p', loadSpeed, pingTime: 100, ...overrides };
}

describe('auto source switch policy', () => {
  it('parses measured load speeds into KB/s', () => {
    expect(parseLoadSpeedKBps('512.0 KB/s')).toBe(512);
    expect(parseLoadSpeedKBps('1.5 MB/s')).toBe(1536);
    expect(parseLoadSpeedKBps('8 Mbps')).toBe(1024);
    expect(parseLoadSpeedKBps('测速中...')).toBe(0);
    expect(parseLoadSpeedKBps('0 KB/s')).toBe(0);
    expect(parseLoadSpeedKBps(undefined)).toBe(0);
  });

  it('skips excluded sources and sources without the target episode', () => {
    const current = createSource('a', ['第1集', '第2集', '第3集']);
    const failed = createSource('b', ['第1集', '第2集', '第3集']);
    const shorter = createSource('c', ['第1集', '第2集']);
    const empty = createSource('d', []);
    const valid = createSource('e', ['第1集', '第2集', '第3集']);

    const candidates = selectAutoSwitchCandidates({
      availableSources: [current, failed, shorter, empty, valid],
      excludedKeys: new Set([
        buildAutoSwitchSourceKey(current.source, current.id),
        buildAutoSwitchSourceKey(failed.source, failed.id),
      ]),
      referenceDetail: current,
      referenceEpisodeIndex: 2,
    });

    expect(candidates.map((candidate) => candidate.source)).toEqual(['e']);
  });

  it('matches the target episode by title rather than position', () => {
    const current = createSource('a', ['第1集', '第2集', '第3集']);
    const offset = createSource('b', ['第2集', '第3集']);

    const candidates = selectAutoSwitchCandidates({
      availableSources: [offset],
      excludedKeys: new Set(),
      referenceDetail: current,
      referenceEpisodeIndex: 2,
    });

    expect(candidates).toEqual([offset]);
  });

  it('ranks measured fast sources first and failed probes last', () => {
    const slow = createSource('slow', ['第1集']);
    const unknown = createSource('unknown', ['第1集']);
    const broken = createSource('broken', ['第1集']);
    const fast = createSource('fast', ['第1集']);

    const ranked = rankAutoSwitchCandidates(
      [broken, slow, unknown, fast],
      new Map([
        [buildAutoSwitchSourceKey(slow.source, slow.id), info('200.0 KB/s')],
        [
          buildAutoSwitchSourceKey(broken.source, broken.id),
          info('9.9 MB/s', { hasError: true }),
        ],
        [buildAutoSwitchSourceKey(fast.source, fast.id), info('2.0 MB/s')],
      ]),
      new Map(),
    );

    expect(ranked.map((candidate) => candidate.source)).toEqual([
      'fast',
      'slow',
      'unknown',
      'broken',
    ]);
  });

  it('ranks failed probes last, then by playback history, then by probe speed', () => {
    const now = Date.UTC(2026, 0, 1);
    const stat = (
      overrides: Partial<SourcePlaybackStat>,
    ): SourcePlaybackStat => ({
      startupMs: 1500,
      successes: 0,
      failures: 0,
      manualSelections: 0,
      lastUsedAt: now,
      ...overrides,
    });
    const unreliable = createSource('unreliable', ['第1集']);
    const broken = createSource('broken', ['第1集']);
    const slow = createSource('slow', ['第1集']);
    const fast = createSource('fast', ['第1集']);
    const manual = createSource('manual', ['第1集']);
    const trusted = createSource('trusted', ['第1集']);
    const trustedBroken = createSource('trustedBroken', ['第1集']);
    const videoInfo = new Map([
      [
        buildAutoSwitchSourceKey(unreliable.source, unreliable.id),
        info('9.9 MB/s'),
      ],
      [
        buildAutoSwitchSourceKey(broken.source, broken.id),
        info('5.0 MB/s', { hasError: true }),
      ],
      [buildAutoSwitchSourceKey(slow.source, slow.id), info('200.0 KB/s')],
      [buildAutoSwitchSourceKey(fast.source, fast.id), info('2.0 MB/s')],
      [
        buildAutoSwitchSourceKey(trusted.source, trusted.id),
        info('100.0 KB/s'),
      ],
      [
        buildAutoSwitchSourceKey(trustedBroken.source, trustedBroken.id),
        info('5.0 MB/s', { hasError: true }),
      ],
    ]);
    const playbackStats = new Map([
      ['unreliable', stat({ failures: 2 })],
      ['manual', stat({ startupMs: null, manualSelections: 2 })],
      ['trusted', stat({ successes: 3 })],
      ['trustedBroken', stat({ successes: 3 })],
    ]);

    const ranked = rankAutoSwitchCandidates(
      [unreliable, broken, slow, fast, manual, trusted, trustedBroken],
      videoInfo,
      playbackStats,
      now,
    );

    expect(ranked.map((candidate) => candidate.source)).toEqual([
      'trusted',
      'manual',
      'fast',
      'slow',
      'unreliable',
      'trustedBroken',
      'broken',
    ]);
  });
});
