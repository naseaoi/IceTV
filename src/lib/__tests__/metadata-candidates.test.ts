import {
  buildPlayRecordCandidate,
  collectFavoriteCandidates,
  collectPlayRecordCandidates,
  ENDED_SERIES_METADATA_REFRESH_TTL_MS,
  shouldRefreshMetadata,
  sortMetadataCandidates,
} from '@/lib/cron/metadata-candidates';
import type { Favorite, PlayRecord } from '@/lib/types';

function createRecord(overrides: Partial<PlayRecord> = {}): PlayRecord {
  return {
    title: '测试番剧',
    source_name: '测试源',
    cover: 'cover.jpg',
    year: '2026',
    index: 2,
    total_episodes: 11,
    play_time: 600,
    total_time: 1440,
    save_time: 1000,
    ...overrides,
  };
}

function createFavorite(overrides: Partial<Favorite> = {}): Favorite {
  return {
    source_name: '测试源',
    total_episodes: 11,
    title: '测试番剧',
    year: '2026',
    cover: 'cover.jpg',
    save_time: 1000,
    ...overrides,
  };
}

const TTL_MS = 6 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 27);

describe('shouldRefreshMetadata', () => {
  it('未检查过、超期或时间异常的条目需要刷新', () => {
    expect(shouldRefreshMetadata(undefined, NOW, TTL_MS)).toBe(true);
    expect(shouldRefreshMetadata(NOW - TTL_MS, NOW, TTL_MS)).toBe(true);
    expect(shouldRefreshMetadata(NOW + 1000, NOW, TTL_MS)).toBe(true);
    expect(shouldRefreshMetadata(NOW - 1000, NOW, TTL_MS)).toBe(false);
  });
});

describe('collectPlayRecordCandidates', () => {
  it.each([undefined, false])(
    '未显式开启（%s）的完结记录按七天边界复查',
    (tracking_enabled) => {
      const record = createRecord({
        series_status: 'ended',
        tracking_enabled,
        metadata_checked_at: NOW - ENDED_SERIES_METADATA_REFRESH_TTL_MS + 1,
      });
      expect(
        buildPlayRecordCandidate('user', 'source+1', record, NOW, TTL_MS),
      ).toBeNull();
      expect(
        buildPlayRecordCandidate(
          'user',
          'source+1',
          {
            ...record,
            metadata_checked_at: NOW - ENDED_SERIES_METADATA_REFRESH_TTL_MS,
          },
          NOW,
          TTL_MS,
        ),
      ).toMatchObject({ priority: 2 });
    },
  );

  it('显式开启的完结作品仍按普通 TTL 检查', () => {
    expect(
      buildPlayRecordCandidate(
        'user',
        'source+1',
        createRecord({
          series_status: 'ended',
          tracking_enabled: true,
          metadata_checked_at: NOW - TTL_MS,
        }),
        NOW,
        TTL_MS,
      ),
    ).not.toBeNull();
  });

  it.each([undefined, 'ongoing'] as const)(
    '状态 %s 仍按普通 TTL 检查',
    (series_status) => {
      expect(
        buildPlayRecordCandidate(
          'user',
          'source+1',
          createRecord({ series_status, metadata_checked_at: NOW - TTL_MS }),
          NOW,
          TTL_MS,
        ),
      ).not.toBeNull();
    },
  );

  it('从未检查的完结记录仍参加刷新', () => {
    expect(
      buildPlayRecordCandidate(
        'user',
        'source+1',
        createRecord({ series_status: 'ended' }),
        NOW,
        TTL_MS,
      ),
    ).not.toBeNull();
  });

  it('跳过尚在 TTL 内的记录', () => {
    const candidates = collectPlayRecordCandidates(
      'user',
      {
        'source+fresh': createRecord({ metadata_checked_at: NOW - 1000 }),
        'source+stale': createRecord({ metadata_checked_at: NOW - TTL_MS }),
      },
      NOW,
      TTL_MS,
    );

    expect(candidates.map((candidate) => candidate.key)).toEqual([
      'source+stale',
    ]);
  });

  it('未看完的记录优先于已看完和已关闭追更的记录', () => {
    const candidates = sortMetadataCandidates(
      collectPlayRecordCandidates(
        'user',
        {
          'source+finished': createRecord({ index: 11, total_episodes: 11 }),
          'source+disabled': createRecord({ tracking_enabled: false }),
          'source+watching': createRecord({ index: 2, total_episodes: 11 }),
        },
        NOW,
        TTL_MS,
      ),
    );

    expect(candidates.map((candidate) => candidate.key)).toEqual([
      'source+watching',
      'source+finished',
      'source+disabled',
    ]);
  });

  it('同优先级下最久未检查的排在前面', () => {
    const candidates = sortMetadataCandidates(
      collectPlayRecordCandidates(
        'user',
        {
          'source+recent': createRecord({ metadata_checked_at: NOW - TTL_MS }),
          'source+never': createRecord(),
          'source+old': createRecord({ metadata_checked_at: NOW - TTL_MS * 5 }),
        },
        NOW,
        TTL_MS,
      ),
    );

    expect(candidates.map((candidate) => candidate.key)).toEqual([
      'source+never',
      'source+old',
      'source+recent',
    ]);
  });

  it('跨用户合并后仍按优先级与陈旧度排序', () => {
    const candidates = sortMetadataCandidates([
      ...collectPlayRecordCandidates(
        'userA',
        { 'source+a': createRecord({ metadata_checked_at: NOW - TTL_MS }) },
        NOW,
        TTL_MS,
      ),
      ...collectPlayRecordCandidates(
        'userB',
        { 'source+b': createRecord() },
        NOW,
        TTL_MS,
      ),
    ]);

    expect(candidates.map((candidate) => candidate.user)).toEqual([
      'userB',
      'userA',
    ]);
  });
});

describe('collectFavoriteCandidates', () => {
  it('排除直播收藏', () => {
    const candidates = collectFavoriteCandidates(
      'user',
      {
        'source+live': createFavorite({ origin: 'live' }),
        'source+vod': createFavorite({ origin: 'vod' }),
      },
      NOW,
      TTL_MS,
    );

    expect(candidates.map((candidate) => candidate.key)).toEqual([
      'source+vod',
    ]);
  });
});
