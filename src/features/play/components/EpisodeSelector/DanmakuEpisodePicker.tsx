'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
): Promise<DanmakuMatchCandidate[]> {
  try {
    const response = await fetch(
      `/api/danmaku/search?keyword=${encodeURIComponent(keyword)}`,
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      candidates?: DanmakuMatchCandidate[];
    };
    return data.candidates || [];
  } catch {
    return [];
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
    setCandidates(results);
    setOpenedSource(null);
    autoOpenedRef.current = false;
    setLoading(false);
  }, []);

  // 已绑定的集所在源只在搜索后自动展开一次，否则「返回源列表」会被立刻撤销
  useEffect(() => {
    if (autoOpenedRef.current || boundEpisodeId === null) return;
    const owner = candidates.find(
      (candidate) => candidate.episodeId === boundEpisodeId,
    );
    if (!owner) return;
    autoOpenedRef.current = true;
    setOpenedSource(owner.animeTitle);
  }, [boundEpisodeId, candidates]);

  useEffect(() => {
    if (!searchTitle || autoSearchedRef.current === searchTitle) return;
    autoSearchedRef.current = searchTitle;
    setKeyword(searchTitle);
    void runSearch(searchTitle);
  }, [searchTitle, runSearch]);

  const handleSelect = useCallback(
    async (episodeId: number) => {
      await persistEpisodeId(source, videoId, episodeIndex, episodeId);
      setBoundEpisodeId(episodeId);
      onBindingChange?.();
    },
    [source, videoId, episodeIndex, onBindingChange],
  );

  const handleClear = useCallback(async () => {
    await clearPersistedEpisodeId(source, videoId, episodeIndex);
    setBoundEpisodeId(null);
    onBindingChange?.();
  }, [source, videoId, episodeIndex, onBindingChange]);

  useEffect(() => {
    if (boundEpisodeId === null || !openedGroup) {
      listContainerRef.current?.scrollTo({ top: 0 });
      syncScrollFade();
      return;
    }
    scrollBoundIntoView(false);
  }, [boundEpisodeId, openedGroup, scrollBoundIntoView, syncScrollFade]);

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
    window.addEventListener('resize', syncScrollFade);
    syncScrollFade();

    const observer = new ResizeObserver(syncScrollFade);
    observer.observe(listContainer);

    return () => {
      listContainer.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', syncScrollFade);
      observer.disconnect();
    };
  }, [openedGroup, sourceGroups, syncScrollFade]);

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
          className='min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-green-500/60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500'
        />
        <button
          type='button'
          onClick={() => void runSearch(keyword)}
          disabled={loading || !keyword.trim()}
          className='relative flex flex-shrink-0 items-center justify-center rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
          aria-busy={loading}
          aria-label={loading ? '搜索中' : undefined}
        >
          <span className={loading ? 'invisible' : undefined}>搜索</span>
          {loading && (
            <span className='absolute h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent' />
          )}
        </button>
      </div>

      {boundEpisodeId !== null && (
        <div className='flex items-center justify-between gap-2 rounded-lg border border-green-500/40 bg-green-500/5 px-3 py-2'>
          <span className='min-w-0 truncate text-xs text-green-600 dark:text-green-400'>
            已绑定集 ID: {boundEpisodeId}
          </span>
          <button
            type='button'
            onClick={() => void handleClear()}
            className='flex-shrink-0 rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          >
            清除绑定
          </button>
        </div>
      )}

      {sourceGroups.length > 0 &&
        (openedGroup ? (
          <button
            type='button'
            onClick={() => setOpenedSource(null)}
            className='flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-xs text-gray-500 transition-colors hover:text-green-600 dark:text-gray-400 dark:hover:text-green-400'
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path d='M15 18l-6-6 6-6' />
            </svg>
            <span className='min-w-0 truncate' title={openedGroup.animeTitle}>
              返回源列表
            </span>
          </button>
        ) : (
          <div className='self-start px-1 py-0.5 text-xs text-gray-500 dark:text-gray-400'>
            弹幕源列表
          </div>
        ))}

      <div className='relative flex min-h-0 flex-1 flex-col'>
        <div
          ref={listContainerRef}
          data-top-fade={hasTopFade}
          data-bottom-fade={hasBottomFade}
          style={getVerticalScrollMaskStyle(hasTopFade, hasBottomFade)}
          className='-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 py-1'
        >
          {candidates.length === 0 && !loading && (
            <div className='py-8 text-center text-sm text-gray-500 dark:text-gray-400'>
              {keyword ? '未找到匹配结果' : '输入关键词搜索番剧'}
            </div>
          )}

          {!openedGroup &&
            sourceGroups.map((group) => {
              const hasBound =
                boundEpisodeId !== null &&
                group.candidates.some(
                  (candidate) => candidate.episodeId === boundEpisodeId,
                );
              return (
                <button
                  key={group.animeTitle}
                  type='button'
                  onClick={() => setOpenedSource(group.animeTitle)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    hasBound
                      ? 'border-green-500/60 bg-green-500/10'
                      : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className='min-w-0 flex-1'>
                    <div
                      className='flex min-w-0 items-center gap-1.5'
                      title={group.animeTitle}
                    >
                      {group.providerLabel && (
                        <span className='flex-shrink-0 rounded bg-green-500/10 px-1.5 py-0.5 text-[11px] font-medium uppercase leading-none tracking-wide text-green-600 dark:bg-green-500/15 dark:text-green-400'>
                          {group.providerLabel}
                        </span>
                      )}
                      <span className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                        {group.displayTitle}
                      </span>
                    </div>
                    <div className='mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400'>
                      <span>{group.candidates.length} 集</span>
                      {group.typeDescription && (
                        <span>{group.typeDescription}</span>
                      )}
                      {hasBound && (
                        <span className='text-green-600 dark:text-green-400'>
                          当前绑定
                        </span>
                      )}
                    </div>
                  </div>
                  <svg
                    xmlns='http://www.w3.org/2000/svg'
                    width='16'
                    height='16'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    className='flex-shrink-0 text-gray-400 dark:text-gray-500'
                  >
                    <path d='M9 18l6-6-6-6' />
                  </svg>
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
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected
                    ? 'border-green-500/60 bg-green-500/10'
                    : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700'
                }`}
              >
                <div
                  className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'
                  title={candidate.episodeTitle || candidate.animeTitle}
                >
                  {candidate.episodeTitle || candidate.animeTitle}
                </div>
                <div className='mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400'>
                  <span>ID: {candidate.episodeId}</span>
                </div>
              </button>
            );
          })}
        </div>

        {!isBoundInView && boundEpisodeId !== null && openedGroup && (
          <button
            type='button'
            onClick={() => {
              if (userScrollTimerRef.current) {
                clearTimeout(userScrollTimerRef.current);
                userScrollTimerRef.current = null;
              }
              scrollBoundIntoView(true);
            }}
            className='absolute bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-all hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-500'
            aria-label='回到已绑定弹幕集'
            title='回到已绑定弹幕集'
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='18'
              height='18'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <circle cx='12' cy='12' r='8' />
              <circle cx='12' cy='12' r='2.5' />
              <line x1='12' y1='2' x2='12' y2='5' />
              <line x1='12' y1='19' x2='12' y2='22' />
              <line x1='2' y1='12' x2='5' y2='12' />
              <line x1='19' y1='12' x2='22' y2='12' />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
