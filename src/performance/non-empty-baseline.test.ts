/** @jest-environment node */

import type Database from 'better-sqlite3';
import { performance } from 'perf_hooks';

import {
  aggregatePlaybackPeriod,
  buildPlaybackPeriod,
} from '@/features/playback-stats/lib/period';
import { createCacheBudgetLedger } from '@/lib/cache-budget';
import {
  clearSearchCachesForTests,
  getSearchCacheStats,
  setCachedSearchPage,
} from '@/lib/search-cache';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import type { SearchResult } from '@/lib/types';

const runBaseline =
  process.env.RUN_PERFORMANCE_BASELINE === '1' ? describe : describe.skip;

function elapsedMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2));
}

runBaseline('non-empty performance baseline', () => {
  jest.setTimeout(120_000);

  it('measures large playback stats, bounded search caches, and VOD budget', async () => {
    const storage = new LocalSqliteStorage(':memory:');
    const database = (storage as unknown as { db: Database.Database }).db;
    const insert = database.prepare(
      `INSERT INTO playback_sessions (
        id, username, source, video_id, episode_index, title, source_name,
        cover, year, started_at, ended_at, watch_seconds, last_position,
        total_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const seed = database.transaction((count: number) => {
      for (let index = 0; index < count; index += 1) {
        const startedAt = index * 1000;
        insert.run(
          `baseline-${index}`,
          'baseline-user',
          `source-${index % 8}`,
          `video-${index % 1000}`,
          index % 24,
          `Baseline title ${index % 1000}`,
          'Baseline source',
          '',
          '2026',
          startedAt,
          startedAt + 600,
          60,
          60,
          120,
          startedAt,
          startedAt + 600,
        );
      }
    });

    const playbackSeedStartedAt = performance.now();
    seed(100_000);
    const playbackSeedMs = elapsedMs(playbackSeedStartedAt);
    const period = buildPlaybackPeriod({ type: 'week', date: '1970-01-01' });
    const playbackQueryStartedAt = performance.now();
    const sessions = await storage.getPlaybackPeriodSessions(
      'baseline-user',
      period.start,
      period.end,
    );
    const totals = await storage.getPlaybackWatchTotals(
      'baseline-user',
      period.start,
    );
    const stats = aggregatePlaybackPeriod(
      period,
      sessions,
      totals.totalWatchSeconds,
    );
    const playbackQueryMs = elapsedMs(playbackQueryStartedAt);

    clearSearchCachesForTests();
    const searchResult: SearchResult = {
      id: 'baseline',
      title: 'Baseline result',
      poster: '',
      episodes: Array.from(
        { length: 20 },
        (_, index) => `https://example.com/${index}.m3u8`,
      ),
      episodes_titles: Array.from({ length: 20 }, (_, index) => `${index + 1}`),
      source: 'baseline',
      source_name: 'Baseline source',
      year: '2026',
      desc: 'd'.repeat(64 * 1024),
    };
    const searchCacheStartedAt = performance.now();
    for (let index = 0; index < 1500; index += 1) {
      setCachedSearchPage('baseline', `query-${index}`, 1, 'ok', [
        { ...searchResult, id: String(index) },
      ]);
    }
    const searchCacheMs = elapsedMs(searchCacheStartedAt);
    const searchCacheStats = getSearchCacheStats().pages;

    const segmentBudget = createCacheBudgetLedger<string>({
      maxEntries: 128,
      maxBytes: 384 * 1024 * 1024,
    });
    segmentBudget.initialize([]);
    const vodBudgetStartedAt = performance.now();
    for (let index = 0; index < 100_000; index += 1) {
      segmentBudget.reserve(
        `https://example.com/segment-${index}.ts`,
        (1 + (index % 4)) * 1024 * 1024,
      );
    }
    const vodBudgetMs = elapsedMs(vodBudgetStartedAt);
    const vodBudgetStats = segmentBudget.stats();

    console.log(
      JSON.stringify(
        {
          playback: {
            rows: 100_000,
            seedMs: playbackSeedMs,
            periodQueryAndAggregationMs: playbackQueryMs,
          },
          searchCache: {
            writes: 1500,
            elapsedMs: searchCacheMs,
            entries: searchCacheStats.size,
            estimatedBytes: searchCacheStats.estimatedBytes,
            evictions: searchCacheStats.evictions,
          },
          vodBudget: {
            reservations: 100_000,
            elapsedMs: vodBudgetMs,
            entries: vodBudgetStats.entries,
            totalBytes: vodBudgetStats.totalBytes,
          },
        },
        null,
        2,
      ),
    );

    expect(stats.buckets).toHaveLength(7);
    expect(stats.topWorks).toHaveLength(10);
    expect(stats.watchSeconds).toBe(6_000_000);
    expect(searchCacheStats.size).toBeLessThanOrEqual(1000);
    expect(searchCacheStats.estimatedBytes).toBeLessThanOrEqual(
      32 * 1024 * 1024,
    );
    expect(vodBudgetStats.entries).toBeLessThanOrEqual(128);
    expect(vodBudgetStats.totalBytes).toBeLessThanOrEqual(384 * 1024 * 1024);

    clearSearchCachesForTests();
    database.close();
  });
});
