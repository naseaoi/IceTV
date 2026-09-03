'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getVerticalScrollMaskStyle } from '@/lib/scroll-edge-fade';
import { SearchResult } from '@/lib/types';

interface AddSourcesModalProps {
  candidates: SearchResult[];
  existingKeys: Set<string>;
  currentEpisodeCount?: number;
  onConfirm: (selected: SearchResult[]) => void;
  onCancel: () => void;
}

export const AddSourcesModal: React.FC<AddSourcesModalProps> = ({
  candidates,
  existingKeys,
  currentEpisodeCount,
  onConfirm,
  onCancel,
}) => {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const [hasTopFade, setHasTopFade] = useState(false);
  const [hasBottomFade, setHasBottomFade] = useState(false);

  const syncScrollFade = useCallback(() => {
    const container = listContainerRef.current;
    if (!container) return;

    const maxScrollTop = Math.max(
      0,
      container.scrollHeight - container.clientHeight,
    );
    setHasTopFade(container.scrollTop > 4);
    setHasBottomFade(
      maxScrollTop > 4 && container.scrollTop < maxScrollTop - 4,
    );
  }, []);

  useEffect(() => {
    const container = listContainerRef.current;
    if (!container) return;

    container.addEventListener('scroll', syncScrollFade, { passive: true });
    window.addEventListener('resize', syncScrollFade);
    syncScrollFade();

    const observer = new ResizeObserver(syncScrollFade);
    observer.observe(container);

    return () => {
      container.removeEventListener('scroll', syncScrollFade);
      window.removeEventListener('resize', syncScrollFade);
      observer.disconnect();
    };
  }, [syncScrollFade]);

  const toggleSelection = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const availableCandidates = useMemo(
    () =>
      candidates.map((candidate) => {
        const key = `${candidate.source}-${candidate.id}`;
        const episodeCount = Math.max(
          candidate.episodes.length,
          candidate.episodes_titles?.length || 0,
        );
        const isExisting = existingKeys.has(key);
        const episodeDiff = currentEpisodeCount
          ? Math.abs(episodeCount - currentEpisodeCount)
          : 0;
        const hasMismatch =
          currentEpisodeCount &&
          episodeCount > 0 &&
          episodeDiff > currentEpisodeCount * 0.3;

        return {
          candidate,
          key,
          episodeCount,
          isExisting,
          hasMismatch,
        };
      }),
    [candidates, existingKeys, currentEpisodeCount],
  );

  const handleConfirm = useCallback(() => {
    const selected = availableCandidates
      .filter((item) => selectedKeys.has(item.key))
      .map((item) => item.candidate);
    onConfirm(selected);
  }, [availableCandidates, selectedKeys, onConfirm]);

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
      onClick={onCancel}
    >
      <div
        className='flex h-full max-h-[600px] w-full max-w-2xl flex-col rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='flex flex-shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700'>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            选择要添加的源站
          </h2>
          <button
            type='button'
            onClick={onCancel}
            className='text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200'
            aria-label='关闭'
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='20'
              height='20'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <line x1='18' y1='6' x2='6' y2='18' />
              <line x1='6' y1='6' x2='18' y2='18' />
            </svg>
          </button>
        </div>

        {currentEpisodeCount && currentEpisodeCount > 0 && (
          <div className='flex-shrink-0 border-b border-gray-200 px-6 py-3 dark:border-gray-700'>
            <div className='rounded-lg border border-blue-500/40 bg-blue-500/5 px-3 py-2 text-xs text-blue-600 dark:text-blue-400'>
              当前片源共 {currentEpisodeCount} 集，集数差异过大的源站已高亮标记
            </div>
          </div>
        )}

        <div className='relative flex min-h-0 flex-1 overflow-hidden'>
          <div
            ref={listContainerRef}
            data-top-fade={hasTopFade}
            data-bottom-fade={hasBottomFade}
            style={getVerticalScrollMaskStyle(hasTopFade, hasBottomFade)}
            className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 py-4'
          >
            {availableCandidates.length === 0 ? (
              <div className='flex flex-1 items-center justify-center py-8 text-sm text-gray-500 dark:text-gray-400'>
                未找到新的源站
              </div>
            ) : (
              availableCandidates.map((item) => (
                <button
                  key={item.key}
                  type='button'
                  disabled={item.isExisting}
                  onClick={() => toggleSelection(item.key)}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    item.isExisting
                      ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-60 dark:border-gray-700 dark:bg-gray-800'
                      : selectedKeys.has(item.key)
                        ? 'border-green-500/60 bg-green-500/10'
                        : item.hasMismatch
                          ? 'border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10'
                          : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700'
                  }`}
                >
                  <div
                    className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${
                      item.isExisting
                        ? 'border-gray-300 dark:border-gray-600'
                        : selectedKeys.has(item.key)
                          ? 'border-green-600 bg-green-600'
                          : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {selectedKeys.has(item.key) && (
                      <svg
                        xmlns='http://www.w3.org/2000/svg'
                        width='12'
                        height='12'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='white'
                        strokeWidth='3'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      >
                        <polyline points='20 6 9 17 4 12' />
                      </svg>
                    )}
                  </div>

                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                      {item.candidate.title}
                    </div>
                    <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400'>
                      <span>{item.candidate.source_name}</span>
                      {item.candidate.type_name && (
                        <span className='rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300'>
                          {item.candidate.type_name}
                        </span>
                      )}
                      {item.episodeCount > 0 && (
                        <span
                          className={
                            item.hasMismatch
                              ? 'font-medium text-amber-600 dark:text-amber-400'
                              : undefined
                          }
                        >
                          {item.episodeCount} 集
                        </span>
                      )}
                      {item.isExisting && (
                        <span className='text-gray-400'>已添加</span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className='flex flex-shrink-0 gap-2 border-t border-gray-200 px-6 py-4 dark:border-gray-700'>
          <button
            type='button'
            onClick={onCancel}
            className='flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          >
            取消
          </button>
          <button
            type='button'
            onClick={handleConfirm}
            disabled={selectedKeys.size === 0}
            className='flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {selectedKeys.size > 0
              ? `添加 ${selectedKeys.size} 个源站`
              : '请选择源站'}
          </button>
        </div>
      </div>
    </div>
  );
};
