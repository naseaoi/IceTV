'use client';

import { ChevronLeft, ChevronRight, LocateFixed } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Spinner from '@/components/Spinner';
import { PanelActionButton } from '@/features/play/components/EpisodeSelector/PanelActionButton';
import {
  type DanmakuSourceGroup,
  groupCandidatesBySource,
} from '@/features/play/lib/danmaku/client';
import {
  clearPersistedEpisodeId,
  getPersistedEpisodeId,
  persistEpisodeId,
} from '@/features/play/lib/danmaku/episode-storage';
import type { DanmakuMatchCandidate } from '@/features/play/lib/danmaku/types';
import { getVerticalScrollMaskStyle } from '@/lib/scroll-edge-fade';

const USER_SCROLL_IDLE_MS = 2000;
const PROGRAMMATIC_SCROLL_MS = 800;

interface DanmakuEpisodePickerProps {
  source: string;
  videoId: string;
  episodeIndex: number;
  searchTitle: string;
  onBindingChange?: () => void;
}

async function fetchCandidates(
  keyword: string,
  offset = 0,
): Promise<{ candidates: DanmakuMatchCandidate[]; hasMore: boolean }> {
  try {
    const response = await fetch(
      `/api/danmaku/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}`,
    );
    if (!response.ok) return { candidates: [], hasMore: false };
    const data = (await response.json()) as {
      candidates?: DanmakuMatchCandidate[];
      hasMore?: boolean;
    };
    return {
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
      hasMore: data.hasMore === true,
    };
  } catch {
    return { candidates: [], hasMore: false };
  }
}

export const DanmakuEpisodePicker: React.FC<DanmakuEpisodePickerProps> = ({
  source,
  videoId,
  episodeIndex,
  searchTitle,
  onBindingChange,
}) => {
  const [keyword, setKeyword] = useState(searchTitle);
  const [candidates, setCandidates] = useState<DanmakuMatchCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMoreCandidates, setHasMoreCandidates] = useState(false);
  const [boundEpisodeId, setBoundEpisodeId] = useState<number | null>(null);
  const [openedSource, setOpenedSource] = useState<string | null>(null);
  const autoSearchedRef = useRef('');
  const autoOpenedRef = useRef(false);

  const sourceGroups = useMemo(
    () => groupCandidatesBySource(candidates),
    [candidates],
  );
  const openedGroup: DanmakuSourceGroup | null = useMemo(
    () =>
      sourceGroups.find((group) => group.animeTitle === openedSource) ?? null,
    [sourceGroups, openedSource],
  );
  const boundSourceTitle = useMemo(
    () =>
      candidates.find((candidate) => candidate.episodeId === boundEpisodeId)
        ?.animeTitle ?? null,
    [boundEpisodeId, candidates],
  );
  const boundItemKey = openedGroup
    ? openedGroup.animeTitle === boundSourceTitle
      ? `episode:${boundEpisodeId}`
      : null
    : boundSourceTitle;
  const locateLabel = openedGroup ? '回到已绑定弹幕集' : '回到当前弹幕源';

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const boundItemRef = useRef<HTMLButtonElement | null>(null);
  const programmaticScrollRef = useRef(false);
  const userScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticScrollTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [isBoundInView, setIsBoundInView] = useState(true);
  const [hasTopFade, setHasTopFade] = useState(false);
  const [hasBottomFade, setHasBottomFade] = useState(false);

  const syncScrollFade = useCallback(() => {
    const listContainer = listContainerRef.current;
    if (!listContainer) return;

    const maxScrollTop = Math.max(
      0,
      listContainer.scrollHeight - listContainer.clientHeight,
    );
    setHasTopFade(listContainer.scrollTop > 4);
    setHasBottomFade(
      maxScrollTop > 4 && listContainer.scrollTop < maxScrollTop - 4,
    );
  }, []);

  const scrollBoundIntoView = useCallback((smooth = true) => {
    const listContainer = listContainerRef.current;
    const boundItem = boundItemRef.current;
    if (!listContainer || !boundItem) return;

    requestAnimationFrame(() => {
      if (
        listContainerRef.current !== listContainer ||
        boundItemRef.current !== boundItem
      )
        return;
      const containerRect = listContainer.getBoundingClientRect();
      const itemRect = boundItem.getBoundingClientRect();
      const targetScrollTop =
        listContainer.scrollTop +
        (itemRect.top - containerRect.top) -
        listContainer.clientHeight / 2 +
        boundItem.clientHeight / 2;

      const maxScrollTop =
        listContainer.scrollHeight - listContainer.clientHeight;
      const nextScrollTop = Math.max(
        0,
        Math.min(targetScrollTop, maxScrollTop),
      );

      programmaticScrollRef.current = true;
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
      programmaticScrollTimerRef.current = setTimeout(() => {
        programmaticScrollRef.current = false;
      }, PROGRAMMATIC_SCROLL_MS);

      listContainer.scrollTo({
        top: nextScrollTop,
        behavior: smooth ? 'smooth' : 'auto',
      });
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void getPersistedEpisodeId(source, videoId, episodeIndex).then((id) => {
      if (alive) setBoundEpisodeId(id);
    });
    return () => {
      alive = false;
    };
  }, [source, videoId, episodeIndex]);

  const runSearch = useCallback(async (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) return;
    setLoading(true);
    const results = await fetchCandidates(trimmed);
    setCandidates(results.candidates);
    setHasMoreCandidates(results.hasMore);
    setOpenedSource(null);
    autoOpenedRef.current = false;
    setLoading(false);
  }, []);

  const loadMore = useCallback(async () => {
    const trimmed = keyword.trim();
    if (loading || !hasMoreCandidates || !trimmed) return;
    setLoading(true);
    const results = await fetchCandidates(trimmed, candidates.length);
    setCandidates((current) => [...current, ...results.candidates]);
    setHasMoreCandidates(results.hasMore);
    setLoading(false);
  }, [candidates.length, hasMoreCandidates, keyword, loading]);

  // 已绑定的集所在源只在搜索后自动展开一次，否则「返回源列表」会被立刻撤销
  useEffect(() => {
    if (autoOpenedRef.current || boundSourceTitle === null) return;
    autoOpenedRef.current = true;
    setOpenedSource(boundSourceTitle);
  }, [boundSourceTitle, candidates]);

  useEffect(() => {
    if (!searchTitle || autoSearchedRef.current === searchTitle) return;
    autoSearchedRef.current = searchTitle;
    setKeyword(searchTitle);
    void runSearch(searchTitle);
  }, [searchTitle, runSearch]);

  const handleSelect = useCallback(
    async (episodeId: number) => {
      await persistEpisodeId(source, videoId, episodeIndex, episodeId, keyword);
      setBoundEpisodeId(episodeId);
      onBindingChange?.();
    },
    [source, videoId, episodeIndex, keyword, onBindingChange],
  );

  const handleClear = useCallback(async () => {
    await clearPersistedEpisodeId(source, videoId, episodeIndex);
    setBoundEpisodeId(null);
    onBindingChange?.();
  }, [source, videoId, episodeIndex, onBindingChange]);

  useEffect(() => {
    if (boundItemKey === null) {
      listContainerRef.current?.scrollTo({ top: 0 });
      syncScrollFade();
      return;
    }
    scrollBoundIntoView(false);
  }, [boundItemKey, openedSource, scrollBoundIntoView, syncScrollFade]);

  useEffect(() => {
    const listContainer = listContainerRef.current;
    if (!listContainer) return;

    const handleScroll = () => {
      syncScrollFade();
      if (!programmaticScrollRef.current) {
        if (userScrollTimerRef.current) {
          clearTimeout(userScrollTimerRef.current);
        }
        userScrollTimerRef.current = setTimeout(() => {
          userScrollTimerRef.current = null;
        }, USER_SCROLL_IDLE_MS);
      }

      const boundItem = boundItemRef.current;
      if (!boundItem) {
        setIsBoundInView(true);
        return;
      }
      const containerRect = listContainer.getBoundingClientRect();
      const itemRect = boundItem.getBoundingClientRect();
      setIsBoundInView(
        itemRect.bottom > containerRect.top &&
          itemRect.top < containerRect.bottom,
      );
    };

    listContainer.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    handleScroll();

    const observer = new ResizeObserver(handleScroll);
    observer.observe(listContainer);

    return () => {
      listContainer.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
      observer.disconnect();
    };
  }, [boundItemKey, openedGroup, sourceGroups, syncScrollFade]);

  useEffect(() => {
    return () => {
      if (userScrollTimerRef.current) clearTimeout(userScrollTimerRef.current);
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
    };
  }, []);

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3'>
      <div className='flex gap-2'>
        <input
          type='text'
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void runSearch(keyword);
          }}
          placeholder='搜索番剧名称'
          className='h-9 min-w-0 flex-1 rounded-lg border-0 bg-gray-900/[0.04] px-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-brand-500/40 dark:bg-white/[0.05] dark:text-gray-100 dark:placeholder:text-gray-500'
        />
        <button
          type='button'
          onClick={() => void runSearch(keyword)}
          disabled={loading || !keyword.trim()}
          className='relative flex h-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900/[0.06] px-3.5 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-900/[0.1] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.12]'
          aria-busy={loading}
          aria-label={loading ? '搜索中' : undefined}
        >
          <span className={loading ? 'invisible' : undefined}>搜索</span>
          {loading && <Spinner className='absolute h-4 w-4' />}
        </button>
      </div>

      {boundEpisodeId !== null && (
        <div className='flex items-center justify-between gap-2 rounded-lg bg-brand-500/[0.08] py-1 pl-3 pr-1 dark:bg-brand-400/[0.08]'>
          <span className='min-w-0 truncate text-xs text-brand-600 dark:text-brand-400'>
            已绑定集 ID: {boundEpisodeId}
          </span>
          <PanelActionButton onClick={() => void handleClear()}>
            清除绑定
          </PanelActionButton>
        </div>
      )}

      {sourceGroups.length > 0 &&
        (openedGroup ? (
          <PanelActionButton
            onClick={() => setOpenedSource(null)}
            className='-ml-2.5 self-start'
          >
            <ChevronLeft className='h-3.5 w-3.5' />
            <span className='min-w-0 truncate' title={openedGroup.animeTitle}>
              返回源列表
            </span>
          </PanelActionButton>
        ) : (
          <div className='self-start text-xs text-gray-400 dark:text-gray-500'>
            弹幕源列表
          </div>
        ))}

      <div className='relative flex min-h-0 flex-1 flex-col'>
        <div
          ref={listContainerRef}
          data-top-fade={hasTopFade}
          data-bottom-fade={hasBottomFade}
          style={getVerticalScrollMaskStyle(hasTopFade, hasBottomFade)}
          className='-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1'
        >
          {candidates.length === 0 && !loading && (
            <div className='px-2 py-6 text-center text-[13px] text-gray-400 dark:text-gray-500'>
              {keyword ? '未找到匹配结果' : '输入关键词搜索番剧'}
            </div>
          )}

          {!openedGroup &&
            sourceGroups.map((group) => {
              const hasBound = group.animeTitle === boundSourceTitle;
              return (
                <button
                  key={group.animeTitle}
                  ref={hasBound ? boundItemRef : null}
                  type='button'
                  aria-current={hasBound ? 'true' : undefined}
                  onClick={() => setOpenedSource(group.animeTitle)}
                  className={`flex w-full shrink-0 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors ${
                    hasBound
                      ? 'bg-brand-500/[0.08] dark:bg-brand-400/[0.08]'
                      : 'hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <div className='min-w-0 flex-1'>
                    <div
                      className='flex min-w-0 items-center gap-1.5'
                      title={group.animeTitle}
                    >
                      {group.providerLabel && (
                        <span className='flex-shrink-0 rounded bg-gray-900/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none tracking-wide text-gray-500 dark:bg-white/[0.08] dark:text-gray-400'>
                          {group.providerLabel}
                        </span>
                      )}
                      <span className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                        {group.displayTitle}
                      </span>
                    </div>
                    <div className='mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400'>
                      <span>{group.candidates.length} 集</span>
                      {group.typeDescription && (
                        <span>{group.typeDescription}</span>
                      )}
                      {hasBound && (
                        <span className='text-brand-600 dark:text-brand-400'>
                          当前绑定
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className='h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500' />
                </button>
              );
            })}

          {openedGroup?.candidates.map((candidate) => {
            const selected = boundEpisodeId === candidate.episodeId;
            return (
              <button
                key={candidate.episodeId}
                ref={selected ? boundItemRef : null}
                type='button'
                aria-pressed={selected}
                onClick={() => void handleSelect(candidate.episodeId)}
                className={`w-full shrink-0 rounded-lg px-2 py-2.5 text-left transition-colors ${
                  selected
                    ? 'bg-brand-500/[0.08] dark:bg-brand-400/[0.08]'
                    : 'hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.04]'
                }`}
              >
                <div
                  className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'
                  title={candidate.episodeTitle || candidate.animeTitle}
                >
                  {candidate.episodeTitle || candidate.animeTitle}
                </div>
                <div className='mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400'>
                  <span>ID: {candidate.episodeId}</span>
                </div>
              </button>
            );
          })}

          {hasMoreCandidates && (
            <button
              type='button'
              disabled={loading}
              onClick={() => void loadMore()}
              className='w-full shrink-0 rounded-lg px-2 py-2.5 text-[13px] text-gray-500 transition-colors hover:bg-gray-900/[0.04] hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-white/[0.04] dark:hover:text-white'
            >
              {loading ? '加载中…' : '加载更多候选'}
            </button>
          )}
        </div>

        {!isBoundInView && boundItemKey !== null && (
          <button
            type='button'
            onClick={() => {
              if (userScrollTimerRef.current) {
                clearTimeout(userScrollTimerRef.current);
                userScrollTimerRef.current = null;
              }
              scrollBoundIntoView(true);
            }}
            className='absolute bottom-4 right-0 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-600 shadow-md shadow-black/10 ring-1 ring-gray-900/[0.06] transition-colors hover:text-brand-600 dark:bg-gray-800 dark:text-gray-300 dark:shadow-black/40 dark:ring-white/10 dark:hover:text-brand-300'
            aria-label={locateLabel}
            title={locateLabel}
          >
            <LocateFixed className='h-4 w-4' />
          </button>
        )}
      </div>
    </div>
  );
};
