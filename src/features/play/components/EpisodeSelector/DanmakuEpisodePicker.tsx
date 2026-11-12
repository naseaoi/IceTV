'use client';

import { Check, ChevronLeft, ChevronRight, LocateFixed } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FLOATING_CONTROL_CLASS } from '@/components/floating-control';
import LoadErrorState from '@/components/LoadErrorState';
import Spinner from '@/components/Spinner';
import { PanelActionButton } from '@/features/play/components/EpisodeSelector/PanelActionButton';
import {
  type DanmakuSourceGroup,
  groupCandidatesBySource,
  splitSourceProvider,
} from '@/features/play/lib/danmaku/client';
import {
  clearPersistedEpisodeId,
  getPersistedEpisodeId,
  persistEpisodeId,
} from '@/features/play/lib/danmaku/episode-storage';
import type { DanmakuMatchCandidate } from '@/features/play/lib/danmaku/types';
import {
  buildDanmakuScopeKey,
  readDanmakuEpisodeSearchTitle,
} from '@/lib/local-preferences';
import { getVerticalScrollMaskStyle } from '@/lib/scroll-edge-fade';
import { showToast } from '@/lib/toast';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

const USER_SCROLL_IDLE_MS = 2000;
const PROGRAMMATIC_SCROLL_MS = 800;
// 弹幕集标题常以「【提供方】」开头，提供方已在源标签中展示
const EPISODE_PROVIDER_PREFIX = /^【[^】]*】\s*/;
const PROVIDER_TAG_CLASS =
  'flex-shrink-0 rounded bg-gray-900/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none tracking-wide text-gray-500 dark:bg-white/[0.08] dark:text-gray-400';

function formatEpisodeTitle(candidate: DanmakuMatchCandidate): string {
  const title = candidate.episodeTitle || candidate.animeTitle;
  return title.replace(EPISODE_PROVIDER_PREFIX, '') || title;
}

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
  const response = await fetch(
    `/api/danmaku/search?keyword=${encodeURIComponent(keyword)}&offset=${offset}`,
  );
  if (!response.ok) throw new Error('Danmaku search failed');
  const data = (await response.json()) as {
    candidates?: DanmakuMatchCandidate[];
    hasMore?: boolean;
  };
  return {
    candidates: Array.isArray(data.candidates) ? data.candidates : [],
    hasMore: data.hasMore === true,
  };
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
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const generationRef = useRef(0);
  useEffect(
    () => () => {
      generationRef.current += 1;
      pendingRef.current = false;
    },
    [],
  );
  const failedMore = useRef(false);
  const searchedKeyword = useRef('');
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
  const boundCandidate = useMemo(
    () =>
      candidates.find((candidate) => candidate.episodeId === boundEpisodeId) ??
      null,
    [boundEpisodeId, candidates],
  );
  const boundSourceTitle = boundCandidate?.animeTitle ?? null;
  const boundSource = boundCandidate
    ? splitSourceProvider(boundCandidate.animeTitle)
    : null;
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
    if (!trimmed || pendingRef.current) return;
    pendingRef.current = true;
    failedMore.current = false;
    const generation = generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const results = await fetchCandidates(trimmed);
      if (generation !== generationRef.current) return;
      searchedKeyword.current = trimmed;
      setCandidates(results.candidates);
      setHasMoreCandidates(results.hasMore);
      setOpenedSource(null);
      autoOpenedRef.current = false;
    } catch (error) {
      if (generation === generationRef.current && !isAbortError(error))
        setError(getErrorMessage(error, '加载失败'));
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  const loadMore = useCallback(async () => {
    const trimmed = searchedKeyword.current;
    if (pendingRef.current || !hasMoreCandidates || !trimmed) return;
    pendingRef.current = true;
    failedMore.current = true;
    const generation = generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const results = await fetchCandidates(trimmed, candidates.length);
      if (generation !== generationRef.current) return;
      setCandidates((current) => [...current, ...results.candidates]);
      setHasMoreCandidates(results.hasMore);
    } catch (error) {
      if (generation === generationRef.current && !isAbortError(error))
        setError(getErrorMessage(error, '加载失败'));
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = false;
        setLoading(false);
      }
    }
  }, [candidates.length, hasMoreCandidates]);

  // 已绑定的集所在源只在搜索后自动展开一次，否则「返回源列表」会被立刻撤销
  useEffect(() => {
    if (autoOpenedRef.current || boundSourceTitle === null) return;
    autoOpenedRef.current = true;
    setOpenedSource(boundSourceTitle);
  }, [boundSourceTitle, candidates]);

  // 与加载器一致，优先用该集上次手动匹配时的关键词，已绑定的弹幕集才能出现在结果里
  useEffect(() => {
    const scopeKey = buildDanmakuScopeKey(source, videoId, episodeIndex);
    const initial =
      (scopeKey && readDanmakuEpisodeSearchTitle(scopeKey)) || searchTitle;
    if (!initial || autoSearchedRef.current === initial) return;
    generationRef.current += 1;
    pendingRef.current = false;
    autoSearchedRef.current = initial;
    setKeyword(initial);
    void runSearch(initial);
  }, [source, videoId, episodeIndex, searchTitle, runSearch]);

  const handleSelect = useCallback(
    async (episodeId: number) => {
      if (
        !(await persistEpisodeId(
          source,
          videoId,
          episodeIndex,
          episodeId,
          keyword,
        ))
      ) {
        showToast('弹幕绑定未能保存，请重试', 'error');
        return;
      }
      setBoundEpisodeId(episodeId);
      onBindingChange?.();
    },
    [source, videoId, episodeIndex, keyword, onBindingChange],
  );

  const handleClear = useCallback(async () => {
    if (!(await clearPersistedEpisodeId(source, videoId, episodeIndex))) {
      showToast('弹幕绑定未能清除，请重试', 'error');
      return;
    }
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
      {boundEpisodeId !== null && (
        <div className='flex items-center gap-3 rounded-xl bg-brand-500/[0.08] py-2.5 pl-3 pr-1.5 dark:bg-brand-400/[0.1]'>
          <div className='min-w-0 flex-1'>
            <div className='flex min-w-0 items-center gap-1.5'>
              {boundSource?.providerLabel && (
                <span className={PROVIDER_TAG_CLASS}>
                  {boundSource.providerLabel}
                </span>
              )}
              <span className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                {boundCandidate
                  ? formatEpisodeTitle(boundCandidate)
                  : '已匹配弹幕'}
              </span>
            </div>
            {boundSource && (
              <div className='mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400'>
                {boundSource.displayTitle}
              </div>
            )}
          </div>
          <PanelActionButton onClick={() => void handleClear()}>
            清除绑定
          </PanelActionButton>
        </div>
      )}

      {error && !loading && (
        <LoadErrorState
          message={error}
          onRetry={() =>
            void (failedMore.current ? loadMore() : runSearch(keyword))
          }
        />
      )}
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

      {openedGroup && (
        <PanelActionButton
          onClick={() => setOpenedSource(null)}
          className='-my-1 self-start'
        >
          <ChevronLeft className='h-3.5 w-3.5' />
          <span className='min-w-0 truncate' title={openedGroup.animeTitle}>
            返回源列表
          </span>
        </PanelActionButton>
      )}

      <div className='relative flex min-h-0 flex-1 flex-col'>
        <div
          ref={listContainerRef}
          data-top-fade={hasTopFade}
          data-bottom-fade={hasBottomFade}
          style={getVerticalScrollMaskStyle(hasTopFade, hasBottomFade)}
          className='flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-1'
        >
          {candidates.length === 0 && !loading && !error && (
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
                  className={`flex w-full shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
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
                        <span className={PROVIDER_TAG_CLASS}>
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
                className={`flex w-full shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                  selected
                    ? 'bg-brand-500/[0.08] dark:bg-brand-400/[0.08]'
                    : 'hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.04]'
                }`}
              >
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    selected
                      ? 'font-medium text-brand-600 dark:text-brand-400'
                      : 'text-gray-800 dark:text-gray-200'
                  }`}
                  title={candidate.episodeTitle || candidate.animeTitle}
                >
                  {formatEpisodeTitle(candidate)}
                </span>
                {selected && (
                  <Check className='h-4 w-4 shrink-0 text-brand-500 dark:text-brand-400' />
                )}
              </button>
            );
          })}

          {hasMoreCandidates && (
            <button
              type='button'
              disabled={loading}
              onClick={() => void loadMore()}
              className='w-full shrink-0 rounded-lg px-3 py-2.5 text-[13px] text-gray-500 transition-colors hover:bg-gray-900/[0.04] hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-400 dark:hover:bg-white/[0.04] dark:hover:text-white'
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
            className={`${FLOATING_CONTROL_CLASS} absolute bottom-4 right-0 z-10 h-8 w-8`}
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
