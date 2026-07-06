import React, { useEffect, useMemo, useRef } from 'react';

import { SearchFilterCategory } from '@/components/SearchResultFilter';
import { VideoCardHandle } from '@/components/VideoCard';
import { SearchResult } from '@/lib/types';

import {
  compareYear,
  computeGroupStats,
  normalizeTitleForAggregation,
} from '../lib/searchUtils';

export type FilterState = {
  source: string;
  title: string;
  year: string;
  yearOrder: 'none' | 'asc' | 'desc';
};

export type AggregatedResultItem = {
  mapKey: string;
  group: SearchResult[];
  title: string;
  poster: string;
  year: string;
  type: 'movie' | 'tv';
  stats: {
    episodes: number;
    source_names: string[];
    douban_id?: number;
  };
};

interface UseSearchAggregationParams {
  searchResults: SearchResult[];
  filterAll: FilterState;
  filterAgg: FilterState;
  searchQuery: string;
}

type SearchIndexBucket = {
  yearMap: Map<string, SearchResult[]>;
  yearOrder: string[];
};

type SearchAggregationIndex = {
  resultCount: number;
  titleBuckets: Map<string, SearchIndexBucket>;
  titleOrder: string[];
  sources: Map<string, string>;
  titles: Set<string>;
  years: Set<string>;
  version: number;
};

function createSearchAggregationIndex(): SearchAggregationIndex {
  return {
    resultCount: 0,
    titleBuckets: new Map(),
    titleOrder: [],
    sources: new Map(),
    titles: new Set(),
    years: new Set(),
    version: 0,
  };
}

function addSearchResultToIndex(
  index: SearchAggregationIndex,
  item: SearchResult,
) {
  if (item.source && item.source_name) {
    index.sources.set(item.source, item.source_name);
  }
  if (item.title) {
    index.titles.add(item.title);
  }
  if (item.year) {
    index.years.add(item.year);
  }

  const normalizedTitle = normalizeTitleForAggregation(item.title || '');
  if (!normalizedTitle) {
    index.resultCount += 1;
    return;
  }

  let bucket = index.titleBuckets.get(normalizedTitle);
  if (!bucket) {
    bucket = {
      yearMap: new Map(),
      yearOrder: [],
    };
    index.titleBuckets.set(normalizedTitle, bucket);
    index.titleOrder.push(normalizedTitle);
  }

  const normalizedYear =
    item.year && item.year !== 'unknown' ? item.year : 'unknown';
  let yearItems = bucket.yearMap.get(normalizedYear);
  if (!yearItems) {
    yearItems = [];
    bucket.yearMap.set(normalizedYear, yearItems);
    bucket.yearOrder.push(normalizedYear);
  }
  yearItems.push(item);
  index.resultCount += 1;
}

function canAppendSearchResults(
  previousResults: SearchResult[],
  nextResults: SearchResult[],
) {
  if (previousResults.length > nextResults.length) {
    return false;
  }
  if (previousResults.length === 0) {
    return true;
  }

  const lastPreviousIndex = previousResults.length - 1;
  return (
    nextResults[0] === previousResults[0] &&
    nextResults[lastPreviousIndex] === previousResults[lastPreviousIndex]
  );
}

function buildSearchAggregationIndex(searchResults: SearchResult[]) {
  const index = createSearchAggregationIndex();
  searchResults.forEach((item) => addSearchResultToIndex(index, item));
  return index;
}

function useSearchAggregationIndex(searchResults: SearchResult[]) {
  const indexRef = useRef<SearchAggregationIndex>(
    createSearchAggregationIndex(),
  );
  const previousResultsRef = useRef<SearchResult[]>([]);

  return useMemo(() => {
    const previousResults = previousResultsRef.current;
    const isAppend = canAppendSearchResults(previousResults, searchResults);
    let index = indexRef.current;

    if (isAppend) {
      searchResults
        .slice(previousResults.length)
        .forEach((item) => addSearchResultToIndex(index, item));
    } else {
      index = buildSearchAggregationIndex(searchResults);
    }

    index.version += 1;
    indexRef.current = index;
    previousResultsRef.current = searchResults;

    return {
      index,
      version: index.version,
    };
  }, [searchResults]);
}

function materializeAggregatedResults(index: SearchAggregationIndex) {
  const groupedResults: [string, SearchResult[]][] = [];

  index.titleOrder.forEach((normalizedTitle) => {
    const bucket = index.titleBuckets.get(normalizedTitle);
    if (!bucket) return;

    const knownYears = bucket.yearOrder.filter((year) => year !== 'unknown');
    const unknownItems = bucket.yearMap.get('unknown') || [];
    const mergeUnknownYear =
      unknownItems.length > 0 && knownYears.length === 1 ? knownYears[0] : '';

    bucket.yearOrder
      .filter((year) => bucket.yearMap.has(year))
      .forEach((year) => {
        if (year === 'unknown' && mergeUnknownYear) {
          return;
        }

        const yearItems = bucket.yearMap.get(year) || [];
        const group =
          year === mergeUnknownYear
            ? yearItems.concat(unknownItems)
            : yearItems;

        groupedResults.push([`${normalizedTitle}-${year}`, group]);
      });
  });

  return groupedResults;
}

export function useSearchAggregation({
  searchResults,
  filterAll,
  filterAgg,
  searchQuery,
}: UseSearchAggregationParams) {
  // 聚合卡片 refs 与统计缓存
  const groupRefs = useRef<
    Map<string, React.RefObject<VideoCardHandle | null>>
  >(new Map());
  const groupStatsRef = useRef<
    Map<
      string,
      { douban_id?: number; episodes?: number; source_names: string[] }
    >
  >(new Map());

  const getGroupRef = (key: string) => {
    let ref = groupRefs.current.get(key);
    if (!ref) {
      ref = React.createRef<VideoCardHandle>();
      groupRefs.current.set(key, ref);
    }
    return ref;
  };

  const trimmedSearchQuery = useMemo(() => searchQuery.trim(), [searchQuery]);
  const searchIndexState = useSearchAggregationIndex(searchResults);

  const aggregatedResults = useMemo(
    () => materializeAggregatedResults(searchIndexState.index),
    [searchIndexState.index],
  );

  const aggregatedResultItems = useMemo<AggregatedResultItem[]>(() => {
    return aggregatedResults.map(([mapKey, group]) => {
      const title = group[0]?.title || '';
      const poster = group[0]?.poster || '';
      const year = group[0]?.year || 'unknown';
      const stats = computeGroupStats(group);

      return {
        mapKey,
        group,
        title,
        poster,
        year,
        type: stats.episodes === 1 ? 'movie' : 'tv',
        stats,
      };
    });
  }, [aggregatedResults]);

  // 聚合增量更新
  useEffect(() => {
    const activeKeys = new Set(
      aggregatedResultItems.map((item) => item.mapKey),
    );

    groupRefs.current.forEach((_, key) => {
      if (!activeKeys.has(key)) {
        groupRefs.current.delete(key);
      }
    });

    groupStatsRef.current.forEach((_, key) => {
      if (!activeKeys.has(key)) {
        groupStatsRef.current.delete(key);
      }
    });

    aggregatedResultItems.forEach(({ mapKey, stats }) => {
      const prev = groupStatsRef.current.get(mapKey);
      if (!prev) {
        groupStatsRef.current.set(mapKey, stats);
        return;
      }
      const ref = groupRefs.current.get(mapKey);
      if (ref && ref.current) {
        if (prev.episodes !== stats.episodes) {
          ref.current.setEpisodes(stats.episodes);
        }
        const prevNames = (prev.source_names || []).join('|');
        const nextNames = (stats.source_names || []).join('|');
        if (prevNames !== nextNames) {
          ref.current.setSourceNames(stats.source_names);
        }
        if (prev.douban_id !== stats.douban_id) {
          ref.current.setDoubanId(stats.douban_id);
        }
        groupStatsRef.current.set(mapKey, stats);
      }
    });
  }, [aggregatedResultItems]);

  const filterOptions = useMemo(() => {
    const { sources, titles, years } = searchIndexState.index;

    const sourceOptions: { label: string; value: string }[] = [
      { label: '全部来源', value: 'all' },
      ...Array.from(sources.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ label, value })),
    ];

    const titleOptions: { label: string; value: string }[] = [
      { label: '全部标题', value: 'all' },
      ...Array.from(titles.values())
        .sort((a, b) => a.localeCompare(b))
        .map((t) => ({ label: t, value: t })),
    ];

    const yearValues = Array.from(years.values());
    const knownYears = yearValues
      .filter((y) => y !== 'unknown')
      .sort((a, b) => parseInt(b) - parseInt(a));
    const hasUnknown = yearValues.includes('unknown');
    const yearOptions: { label: string; value: string }[] = [
      { label: '全部年份', value: 'all' },
      ...knownYears.map((y) => ({ label: y, value: y })),
      ...(hasUnknown ? [{ label: '未知', value: 'unknown' }] : []),
    ];

    const categoriesAll: SearchFilterCategory[] = [
      { key: 'source', label: '来源', options: sourceOptions },
      { key: 'title', label: '标题', options: titleOptions },
      { key: 'year', label: '年份', options: yearOptions },
    ];

    const categoriesAgg: SearchFilterCategory[] = [
      { key: 'source', label: '来源', options: sourceOptions },
      { key: 'title', label: '标题', options: titleOptions },
      { key: 'year', label: '年份', options: yearOptions },
    ];

    return { categoriesAll, categoriesAgg };
  }, [searchIndexState.index]);

  // 非聚合筛选排序
  const filteredAllResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAll;

    if (
      source === 'all' &&
      title === 'all' &&
      year === 'all' &&
      yearOrder === 'none'
    ) {
      return searchResults;
    }

    const filtered = searchResults.filter((item) => {
      if (source !== 'all' && item.source !== source) return false;
      if (title !== 'all' && item.title !== title) return false;
      if (year !== 'all' && item.year !== year) return false;
      return true;
    });

    if (yearOrder === 'none') {
      return filtered;
    }

    return filtered.sort((a, b) => {
      const yearComp = compareYear(a.year, b.year, yearOrder);
      if (yearComp !== 0) return yearComp;

      const aExactMatch = a.title === trimmedSearchQuery;
      const bExactMatch = b.title === trimmedSearchQuery;
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      return yearOrder === 'asc'
        ? a.title.localeCompare(b.title)
        : b.title.localeCompare(a.title);
    });
  }, [searchResults, filterAll, trimmedSearchQuery]);

  // 聚合筛选+排序
  const filteredAggResults = useMemo(() => {
    const { source, title, year, yearOrder } = filterAgg;

    if (
      source === 'all' &&
      title === 'all' &&
      year === 'all' &&
      yearOrder === 'none'
    ) {
      return aggregatedResultItems;
    }

    const filtered = aggregatedResultItems.filter((item) => {
      const gTitle = item.title;
      const gYear = item.year;
      const hasSource =
        source === 'all'
          ? true
          : item.group.some((groupItem) => groupItem.source === source);
      if (!hasSource) return false;
      if (title !== 'all' && gTitle !== title) return false;
      if (year !== 'all' && gYear !== year) return false;
      return true;
    });

    if (yearOrder === 'none') {
      return filtered;
    }

    return filtered.sort((a, b) => {
      const aYear = a.year;
      const bYear = b.year;
      const yearComp = compareYear(aYear, bYear, yearOrder);
      if (yearComp !== 0) return yearComp;

      const aExactMatch = a.title === trimmedSearchQuery;
      const bExactMatch = b.title === trimmedSearchQuery;
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      const aTitle = a.title;
      const bTitle = b.title;
      return yearOrder === 'asc'
        ? aTitle.localeCompare(bTitle)
        : bTitle.localeCompare(aTitle);
    });
  }, [aggregatedResultItems, filterAgg, trimmedSearchQuery]);

  return {
    filterOptions,
    filteredAllResults,
    filteredAggResults,
    getGroupRef,
  };
}
