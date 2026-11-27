'use client';

import { MutableRefObject, useCallback, useRef, useState } from 'react';

import { setFavoriteTracking, setPlayRecordTracking } from '@/lib/db.client';
import { triggerGlobalError } from '@/lib/db.client.internal';
import {
  TrackingUpdateUserMessage,
  UserMessage,
  UserMessagePage,
} from '@/lib/message-types';
import {
  getMessagePage,
  readAllMessages,
  readMessage,
} from '@/lib/messages.client';
import { showToast } from '@/lib/toast';

import {
  getMessagePreviewMode,
  getMessagePreviewPage,
} from './message-preview';

export const untrackWorkingId = (messageId: string) => `untrack:${messageId}`;

const EMPTY_PAGE: UserMessagePage = {
  items: [],
  total: 0,
  nextCursor: null,
};

interface MessagePaginationOptions {
  previewModeRef: MutableRefObject<ReturnType<typeof getMessagePreviewMode>>;
  onAfterMutate: () => Promise<void>;
}

export interface MessagePagination {
  page: UserMessagePage;
  setPage: (page: UserMessagePage) => void;
  loading: boolean;
  loadingMore: boolean;
  loadError: string | null;
  workingIds: Set<string>;
  loadFirstPage: () => Promise<void>;
  loadMore: () => Promise<void>;
  readOne: (message: UserMessage) => Promise<boolean>;
  untrack: (message: TrackingUpdateUserMessage) => Promise<boolean>;
  readAll: () => Promise<void>;
  reset: () => void;
}

export function useMessagePagination({
  previewModeRef,
  onAfterMutate,
}: MessagePaginationOptions): MessagePagination {
  const [page, setPage] = useState<UserMessagePage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());
  const firstPageRequestRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const dropMessage = useCallback((messageId: string) => {
    setPage((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== messageId),
      total: Math.max(0, current.total - 1),
    }));
  }, []);

  const loadFirstPage = useCallback(async () => {
    const requestId = ++firstPageRequestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      if (previewModeRef.current) {
        setPage(getMessagePreviewPage());
        return;
      }
      const nextPage = await getMessagePage();
      if (requestId === firstPageRequestRef.current) {
        setPage(nextPage);
      }
    } catch (error) {
      console.error('加载消息列表失败:', error);
      if (requestId === firstPageRequestRef.current) {
        setLoadError('请检查网络连接后重试');
      }
    } finally {
      if (requestId === firstPageRequestRef.current) {
        setLoading(false);
      }
    }
  }, [previewModeRef]);

  const loadMore = useCallback(async () => {
    if (!page.nextCursor || loadingMoreRef.current) return;
    const requestId = firstPageRequestRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = await getMessagePage(page.nextCursor);
      if (requestId !== firstPageRequestRef.current) return;
      setPage((current) => ({
        items: [...current.items, ...nextPage.items],
        total: nextPage.total,
        nextCursor: nextPage.nextCursor,
      }));
    } catch (error) {
      console.error('加载更多消息失败:', error);
      triggerGlobalError('加载更多消息失败');
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [page.nextCursor]);

  const readOne = useCallback(
    async (message: UserMessage) => {
      if (previewModeRef.current) {
        dropMessage(message.id);
        return false;
      }
      setWorkingIds((current) => new Set(current).add(message.id));
      try {
        await readMessage(message.id);
        dropMessage(message.id);
        await onAfterMutate();
        return true;
      } catch (error) {
        console.error('标记消息已读失败:', error);
        triggerGlobalError('标记消息已读失败');
        return false;
      } finally {
        setWorkingIds((current) => {
          const next = new Set(current);
          next.delete(message.id);
          return next;
        });
      }
    },
    [dropMessage, onAfterMutate, previewModeRef],
  );

  const untrack = useCallback(
    async (message: TrackingUpdateUserMessage) => {
      if (previewModeRef.current) {
        dropMessage(message.id);
        return false;
      }
      const workingId = untrackWorkingId(message.id);
      setWorkingIds((current) => new Set(current).add(workingId));
      try {
        // 收藏更新只在没有同键播放记录时产生，ID 前缀即可区分追更归属
        if (message.id.startsWith('favorite-tracking:')) {
          await setFavoriteTracking(message.source, message.videoId, false);
        } else {
          await setPlayRecordTracking(message.source, message.videoId, false);
        }
        dropMessage(message.id);
        showToast('已取消追更', 'success');
        await onAfterMutate();
        return true;
      } catch {
        // 写入失败已由 db.client 统一提示
        return false;
      } finally {
        setWorkingIds((current) => {
          const next = new Set(current);
          next.delete(workingId);
          return next;
        });
      }
    },
    [dropMessage, onAfterMutate, previewModeRef],
  );

  const readAll = useCallback(async () => {
    if (previewModeRef.current) {
      setPage(EMPTY_PAGE);
      return;
    }
    setWorkingIds(new Set(['all']));
    try {
      await readAllMessages();
      setPage(EMPTY_PAGE);
      await onAfterMutate();
    } catch (error) {
      console.error('全部标记已读失败:', error);
      triggerGlobalError('全部标记已读失败');
    } finally {
      setWorkingIds(new Set());
    }
  }, [onAfterMutate, previewModeRef]);

  const reset = useCallback(() => {
    firstPageRequestRef.current += 1;
    setPage(EMPTY_PAGE);
    setLoadError(null);
  }, []);

  return {
    page,
    setPage,
    loading,
    loadingMore,
    loadError,
    workingIds,
    loadFirstPage,
    loadMore,
    readOne,
    untrack,
    readAll,
    reset,
  };
}
