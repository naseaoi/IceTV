import type { SearchResult } from '@/lib/types';

import { resolveRequestedProbeEpisodeUrl } from '@/features/play/lib/sourceProbeStore';

function createSearchResult(partial: Partial<SearchResult>): SearchResult {
  return {
    id: '1',
    title: 'test',
    poster: '',
    episodes: [],
    episodes_titles: [],
    source: 'source-a',
    source_name: 'Source A',
    year: '2026',
    ...partial,
  };
}

describe('sourceProbeStore helpers', () => {
  it('会返回指定集数对应的测速地址', () => {
    const source = createSearchResult({
      episodes: ['ep1', 'ep2', 'ep3'],
    });

    expect(resolveRequestedProbeEpisodeUrl(source, 1)).toBe('ep2');
  });

  it('待测速集不存在时返回 null', () => {
    const source = createSearchResult({
      episodes: ['ep1'],
    });

    expect(resolveRequestedProbeEpisodeUrl(source, null)).toBeNull();
    expect(resolveRequestedProbeEpisodeUrl(source, 3)).toBeNull();
  });
});
