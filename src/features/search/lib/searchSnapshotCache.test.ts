import type { SearchResult } from '@/lib/types';

import {
  clearSearchSnapshotCache,
  getSearchSnapshot,
  getSearchSnapshotCacheStats,
  setSearchSnapshot,
} from './searchSnapshotCache';

function createResult(id: string): SearchResult {
  return {
    id,
    title: `Result ${id}`,
    poster: '',
    episodes: [],
    episodes_titles: [],
    source: 'snapshot-test',
    source_name: 'Snapshot Test',
    year: '2026',
  };
}

describe('search snapshot cache', () => {
  afterEach(() => {
    clearSearchSnapshotCache();
  });

  it('keeps only the most recently used query snapshots', () => {
    for (let index = 0; index < 12; index += 1) {
      setSearchSnapshot(`query-${index}`, {
        results: [createResult(String(index))],
        totalSources: 1,
        completedSources: 1,
        useFluidSearch: true,
      });
    }
    expect(getSearchSnapshot('query-0')).not.toBeNull();

    setSearchSnapshot('query-12', {
      results: [createResult('12')],
      totalSources: 1,
      completedSources: 1,
      useFluidSearch: true,
    });

    expect(getSearchSnapshot('query-0')).not.toBeNull();
    expect(getSearchSnapshot('query-1')).toBeNull();
    expect(getSearchSnapshotCacheStats().size).toBe(12);
  });
});
