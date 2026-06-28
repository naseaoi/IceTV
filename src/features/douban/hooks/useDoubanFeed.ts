'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
import { selectBangumiCardCover } from '@/lib/bangumi-normalize';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';
import { DoubanItem, DoubanResult } from '@/lib/types';

export interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

interface FeedSnapshot {
  type: string;
  primarySelection: string;
  secondarySelection: string;
  multiLevelSelection: Record<string, string>;
  selectedWeekday: string;
  currentPage: number;
}

const DEFAULT_MULTI_LEVEL: Record<string, string> = {
  type: 'all',
  region: 'all',
  year: 'all',
  platform: 'all',
  label: 'all',
  sort: 'T',
};
const FEED_VIEW_CACHE_MS = 60 * 60 * 1000;
const FEED_LOAD_DEBOUNCE_MS = 50;

const feedViewCache = new Map<
  string,
  {
    data: DoubanItem[];
    hasMore: boolean;
    currentPage: number;
    expiresAt: number;
  }
>();
const lastFeedSnapshotByType = new Map<string, FeedSnapshot>();

function computeInitialPrimary(type: string): string {
  if (type === 'movie') return '热门';
  if (type === 'tv' || type === 'show') return '最近热门';
  if (type === 'anime') return '每日放送';
  return '';
}

function computeInitialSecondary(type: string): string {
  if (type === 'movie') return '全部';
  if (type === 'tv') return 'tv';
  if (type === 'show') return 'show';
  return '全部';
}

export function getCurrentWeekday(): string {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return weekdays[new Date().getDay()];
}

function isSnapshotEqual(a: FeedSnapshot, b: FeedSnapshot): boolean {
  return (
    a.type === b.type &&
    a.primarySelection === b.primarySelection &&
    a.secondarySelection === b.secondarySelection &&
    a.selectedWeekday === b.selectedWeekday &&
    a.currentPage === b.currentPage &&
    JSON.stringify(a.multiLevelSelection) ===
      JSON.stringify(b.multiLevelSelection)
  );
}

function getFeedViewCacheKey(snapshot: FeedSnapshot): string {
  const selectedWeekday =
    snapshot.type === 'anime' && snapshot.primarySelection === '每日放送'
      ? snapshot.selectedWeekday
      : '';

  return JSON.stringify([
    snapshot.type,
    snapshot.primarySelection,
    snapshot.secondarySelection,
    selectedWeekday,
    normalizeMultiLevelSelection(snapshot.multiLevelSelection),
  ]);
}

function normalizeMultiLevelSelection(values: Record<string, string>) {
  return Object.keys(values)
    .sort()
    .map((key) => [key, values[key]]);
}

function readFeedViewCache(snapshot: FeedSnapshot) {
  const key = getFeedViewCacheKey(snapshot);
  const cached = feedViewCache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    feedViewCache.delete(key);
    return null;
  }

  return cached;
}

function writeFeedViewCache(
  snapshot: FeedSnapshot,
  data: DoubanItem[],
  hasMore: boolean,
) {
  const currentPage = Math.max(0, snapshot.currentPage);
  feedViewCache.set(getFeedViewCacheKey(snapshot), {
    data,
    hasMore,
    currentPage,
    expiresAt: Date.now() + FEED_VIEW_CACHE_MS,
  });
  lastFeedSnapshotByType.set(snapshot.type, {
    ...snapshot,
    currentPage,
  });

  if (feedViewCache.size > 20) {
    const firstKey = feedViewCache.keys().next().value;
    if (firstKey) {
      feedViewCache.delete(firstKey);
    }
  }
}

function readLastFeedSnapshot(type: string): FeedSnapshot | null {
  const snapshot = lastFeedSnapshotByType.get(type);
  if (!snapshot) {
    return null;
  }

  const cached = readFeedViewCache(snapshot);
  if (!cached) {
    lastFeedSnapshotByType.delete(type);
    return null;
  }

  return {
    ...snapshot,
    currentPage: cached.currentPage,
  };
}

function getInitialHasMore(snapshot: FeedSnapshot, data: DoubanItem[]) {
  if (snapshot.type === 'anime' && snapshot.primarySelection === '每日放送') {
    return false;
  }

  return data.length !== 0;
}

export function primeDefaultDoubanFeedViewCache(
  type: string,
  data: DoubanItem[],
  options: { selectedWeekday?: string } = {},
) {
  if (data.length === 0) {
    return;
  }

  const snapshot: FeedSnapshot = {
    type,
    primarySelection: computeInitialPrimary(type),
    secondarySelection: computeInitialSecondary(type),
    multiLevelSelection: { ...DEFAULT_MULTI_LEVEL },
    selectedWeekday: type === 'anime' ? options.selectedWeekday || '' : '',
    currentPage: 0,
  };

  writeFeedViewCache(snapshot, data, getInitialHasMore(snapshot, data));
}

export function useDoubanFeed(type: string) {
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectorsReady, setSelectorsReady] = useState(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const restoredCurrentPageRef = useRef<number | null>(null);

  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(
    [],
  );

  const [primarySelection, setPrimarySelection] = useState<string>(() =>
    computeInitialPrimary(type),
  );
  const [secondarySelection, setSecondarySelection] = useState<string>(() =>
    computeInitialSecondary(type),
  );
  const [multiLevelValues, setMultiLevelValues] = useState<
    Record<string, string>
  >({ ...DEFAULT_MULTI_LEVEL });
  const [selectedWeekday, setSelectedWeekday] = useState<string>(() =>
    getCurrentWeekday(),
  );

  const currentParamsRef = useRef<FeedSnapshot>({
    type: '',
    primarySelection: '',
    secondarySelection: '',
    multiLevelSelection: {} as Record<string, string>,
    selectedWeekday: '',
    currentPage: 0,
  });

  useEffect(() => {
    const runtimeConfig = window.RUNTIME_CONFIG;
    if ((runtimeConfig?.CUSTOM_CATEGORIES?.length ?? 0) > 0) {
      setCustomCategories(runtimeConfig!.CUSTOM_CATEGORIES);
    }
  }, []);

  useEffect(() => {
    currentParamsRef.current = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage,
    };
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    currentPage,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  useLayoutEffect(() => {
    setSelectorsReady(false);
    let nextPrimarySelection = '';
    let nextSecondarySelection = '全部';

    if (type === 'custom' && customCategories.length > 0) {
      const types = Array.from(
        new Set(customCategories.map((cat) => cat.type)),
      );
      if (types.length > 0) {
        let selectedType = types[0];
        if (types.includes('movie')) {
          selectedType = 'movie';
        } else {
          selectedType = 'tv';
        }
        nextPrimarySelection = selectedType;

        const firstCategory = customCategories.find(
          (cat) => cat.type === selectedType,
        );
        if (firstCategory) {
          nextSecondarySelection = firstCategory.query;
        }
      }
    } else if (type === 'movie') {
      nextPrimarySelection = '热门';
      nextSecondarySelection = '全部';
    } else if (type === 'tv') {
      nextPrimarySelection = '最近热门';
      nextSecondarySelection = 'tv';
    } else if (type === 'show') {
      nextPrimarySelection = '最近热门';
      nextSecondarySelection = 'show';
    } else if (type === 'anime') {
      nextPrimarySelection = '每日放送';
      nextSecondarySelection = '全部';
    }

    let nextMultiLevelValues = { ...DEFAULT_MULTI_LEVEL };
    let nextSelectedWeekday = selectedWeekday;

    const restoredSnapshot = readLastFeedSnapshot(type);
    const requestSnapshot = restoredSnapshot ?? {
      type,
      primarySelection: nextPrimarySelection,
      secondarySelection: nextSecondarySelection,
      multiLevelSelection: nextMultiLevelValues,
      selectedWeekday,
      currentPage: 0,
    };

    if (restoredSnapshot) {
      nextPrimarySelection = restoredSnapshot.primarySelection;
      nextSecondarySelection = restoredSnapshot.secondarySelection;
      nextMultiLevelValues = restoredSnapshot.multiLevelSelection;
      nextSelectedWeekday = restoredSnapshot.selectedWeekday;
    }

    setPrimarySelection(nextPrimarySelection);
    setSecondarySelection(nextSecondarySelection);
    setMultiLevelValues(nextMultiLevelValues);
    setSelectedWeekday(nextSelectedWeekday);

    const cached = readFeedViewCache(requestSnapshot);

    if (cached) {
      setDoubanData(cached.data);
      restoredCurrentPageRef.current =
        cached.currentPage > 0 ? cached.currentPage : null;
      setCurrentPage(cached.currentPage);
      setHasMore(cached.hasMore);
      setIsLoadingMore(false);
      setLoading(false);
      setSelectorsReady(true);
      return;
    }

    setLoading(true);

    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, [type, customCategories]);

  const getRequestParams = useCallback(
    (pageStart: number) => {
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: secondarySelection,
          pageLimit: 25,
          pageStart,
        };
      }
      return {
        kind: type as 'tv' | 'movie',
        category: primarySelection,
        type: secondarySelection,
        pageLimit: 25,
        pageStart,
      };
    },
    [type, primarySelection, secondarySelection],
  );

  const loadInitialData = useCallback(async () => {
    const requestSnapshot: FeedSnapshot = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage: 0,
    };

    try {
      const cached = readFeedViewCache(requestSnapshot);
      if (cached) {
        setDoubanData(cached.data);
        restoredCurrentPageRef.current =
          cached.currentPage > 0 ? cached.currentPage : null;
        setCurrentPage(cached.currentPage);
        setHasMore(cached.hasMore);
        setIsLoadingMore(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setDoubanData([]);
      setCurrentPage(0);
      setHasMore(true);
      setIsLoadingMore(false);

      let data: DoubanResult;

      if (type === 'custom') {
        const selectedCategory = customCategories.find(
          (cat) =>
            cat.type === primarySelection && cat.query === secondarySelection,
        );
        if (selectedCategory) {
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: 25,
            pageStart: 0,
          });
        } else {
          throw new Error('没有找到对应的分类');
        }
      } else if (type === 'anime' && primarySelection === '每日放送') {
        const calendarData = await GetBangumiCalendarData();
        const weekdayData = calendarData.find(
          (item) => item.weekday.en === selectedWeekday,
        );
        if (weekdayData) {
          data = {
            code: 200,
            message: 'success',
            list: weekdayData.items.map((item) => ({
              id: item.id?.toString() || '',
              title: item.name_cn || item.name,
              poster: selectBangumiCardCover(item.images),
              rate: item.rating?.score?.toFixed(1) || '',
              year: item.air_date?.split('-')?.[0] || '',
            })),
          };
        } else {
          throw new Error('没有找到对应的日期');
        }
      } else if (type === 'anime') {
        data = await getDoubanRecommends({
          kind: primarySelection === '番剧' ? 'tv' : 'movie',
          pageLimit: 25,
          pageStart: 0,
          category: '动画',
          format: primarySelection === '番剧' ? '电视剧' : '',
          region: multiLevelValues.region || '',
          year: multiLevelValues.year || '',
          platform: multiLevelValues.platform || '',
          sort: multiLevelValues.sort || '',
          label: multiLevelValues.label || '',
        });
      } else if (primarySelection === '全部') {
        data = await getDoubanRecommends({
          kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
          pageLimit: 25,
          pageStart: 0,
          category: multiLevelValues.type || '',
          format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
          region: multiLevelValues.region || '',
          year: multiLevelValues.year || '',
          platform: multiLevelValues.platform || '',
          sort: multiLevelValues.sort || '',
          label: multiLevelValues.label || '',
        });
      } else {
        data = await getDoubanCategories(getRequestParams(0));
      }

      if (data.code === 200) {
        const currentSnapshot = { ...currentParamsRef.current };
        if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
          const nextHasMore = getInitialHasMore(requestSnapshot, data.list);
          setDoubanData(data.list);
          restoredCurrentPageRef.current = null;
          setCurrentPage(0);
          setHasMore(nextHasMore);
          setLoading(false);
          writeFeedViewCache(requestSnapshot, data.list, nextHasMore);
        }
      } else {
        throw new Error(data.message || '获取数据失败');
      }
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    getRequestParams,
    customCategories,
  ]);

  useEffect(() => {
    if (!selectorsReady) {
      return;
    }

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      loadInitialData();
    }, FEED_LOAD_DEBOUNCE_MS);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [
    selectorsReady,
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    loadInitialData,
  ]);

  useEffect(() => {
    if (currentPage <= 0) return;
    if (restoredCurrentPageRef.current === currentPage) {
      restoredCurrentPageRef.current = null;
      return;
    }

    const fetchMoreData = async () => {
      const requestSnapshot: FeedSnapshot = {
        type,
        primarySelection,
        secondarySelection,
        multiLevelSelection: multiLevelValues,
        selectedWeekday,
        currentPage,
      };

      try {
        setIsLoadingMore(true);

        let data: DoubanResult;
        if (type === 'custom') {
          const selectedCategory = customCategories.find(
            (cat) =>
              cat.type === primarySelection && cat.query === secondarySelection,
          );
          if (selectedCategory) {
            data = await getDoubanList({
              tag: selectedCategory.query,
              type: selectedCategory.type,
              pageLimit: 25,
              pageStart: currentPage * 25,
            });
          } else {
            throw new Error('没有找到对应的分类');
          }
        } else if (type === 'anime' && primarySelection === '每日放送') {
          data = {
            code: 200,
            message: 'success',
            list: [],
          };
        } else if (type === 'anime') {
          data = await getDoubanRecommends({
            kind: primarySelection === '番剧' ? 'tv' : 'movie',
            pageLimit: 25,
            pageStart: currentPage * 25,
            category: '动画',
            format: primarySelection === '番剧' ? '电视剧' : '',
            region: multiLevelValues.region || '',
            year: multiLevelValues.year || '',
            platform: multiLevelValues.platform || '',
            sort: multiLevelValues.sort || '',
            label: multiLevelValues.label || '',
          });
        } else if (primarySelection === '全部') {
          data = await getDoubanRecommends({
            kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
            pageLimit: 25,
            pageStart: currentPage * 25,
            category: multiLevelValues.type || '',
            format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
            region: multiLevelValues.region || '',
            year: multiLevelValues.year || '',
            platform: multiLevelValues.platform || '',
            sort: multiLevelValues.sort || '',
            label: multiLevelValues.label || '',
          });
        } else {
          data = await getDoubanCategories(getRequestParams(currentPage * 25));
        }

        if (data.code === 200) {
          const currentSnapshot = { ...currentParamsRef.current };
          if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
            const nextHasMore = data.list.length !== 0;
            setDoubanData((prev) => {
              const nextData = [...prev, ...data.list];
              writeFeedViewCache(requestSnapshot, nextData, nextHasMore);
              return nextData;
            });
            setHasMore(nextHasMore);
            setIsLoadingMore(false);
          }
        } else {
          throw new Error(data.message || '获取数据失败');
        }
      } catch (err) {
        console.error(err);
        setIsLoadingMore(false);
      }
    };

    fetchMoreData();
  }, [
    currentPage,
    type,
    primarySelection,
    secondarySelection,
    customCategories,
    multiLevelValues,
    selectedWeekday,
    getRequestParams,
  ]);

  const handlePrimaryChange = useCallback(
    (value: string) => {
      if (value === primarySelection) return;

      setLoading(true);
      setCurrentPage(0);
      setDoubanData([]);
      setHasMore(true);
      setIsLoadingMore(false);
      setMultiLevelValues({ ...DEFAULT_MULTI_LEVEL });

      if (type === 'custom' && customCategories.length > 0) {
        const firstCategory = customCategories.find(
          (cat) => cat.type === value,
        );
        if (firstCategory) {
          setPrimarySelection(value);
          setSecondarySelection(firstCategory.query);
        } else {
          setPrimarySelection(value);
        }
      } else if ((type === 'tv' || type === 'show') && value === '最近热门') {
        setPrimarySelection(value);
        if (type === 'tv') {
          setSecondarySelection('tv');
        } else if (type === 'show') {
          setSecondarySelection('show');
        }
      } else {
        setPrimarySelection(value);
      }
    },
    [primarySelection, type, customCategories],
  );

  const handleSecondaryChange = useCallback(
    (value: string) => {
      if (value === secondarySelection) return;
      setLoading(true);
      setCurrentPage(0);
      setDoubanData([]);
      setHasMore(true);
      setIsLoadingMore(false);
      setSecondarySelection(value);
    },
    [secondarySelection],
  );

  const handleMultiLevelChange = useCallback(
    (values: Record<string, string>) => {
      const isEqual = (
        obj1: Record<string, string>,
        obj2: Record<string, string>,
      ) => {
        const keys1 = Object.keys(obj1).sort();
        const keys2 = Object.keys(obj2).sort();
        if (keys1.length !== keys2.length) return false;
        return keys1.every((key) => obj1[key] === obj2[key]);
      };

      if (isEqual(values, multiLevelValues)) {
        return;
      }

      setLoading(true);
      setCurrentPage(0);
      setDoubanData([]);
      setHasMore(true);
      setIsLoadingMore(false);
      setMultiLevelValues(values);
    },
    [multiLevelValues],
  );

  const handleWeekdayChange = useCallback((weekday: string) => {
    setSelectedWeekday(weekday);
  }, []);

  const loadNextPage = useCallback(() => {
    setCurrentPage((prev) => prev + 1);
  }, []);

  return {
    doubanData,
    loading,
    selectorsReady,
    hasMore,
    isLoadingMore,
    primarySelection,
    secondarySelection,
    customCategories,
    handlePrimaryChange,
    handleSecondaryChange,
    handleMultiLevelChange,
    handleWeekdayChange,
    loadNextPage,
  };
}
