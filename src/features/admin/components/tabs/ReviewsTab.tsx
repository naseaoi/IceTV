'use client';

import { Loader2, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import ExpandableText from '@/components/ExpandableText';
import AlertModal from '@/components/modals/AlertModal';
import ConfirmModal from '@/components/modals/ConfirmModal';
import RatingStars from '@/components/RatingStars';
import ReviewReports from '@/features/admin/components/tabs/ReviewReports';
import {
  adminDelete,
  adminGet,
  getAdminReviewReports,
} from '@/features/admin/lib/api';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { useAlertModal } from '@/hooks/useAlertModal';
import { formatRating } from '@/lib/rating';
import { formatRelativeTime } from '@/lib/relative-time';
import { type AdminVideoReview, type AdminVideoReviewPage } from '@/lib/types';

function reviewKey(review: AdminVideoReview): string {
  return JSON.stringify([review.username, review.title_norm, review.year]);
}

function ReviewContent({ content }: { content: string }) {
  return (
    <div className='mt-3'>
      <ExpandableText
        text={content || '仅评分，未填写评价'}
        lines={3}
        maxChars={120}
        collapseLabel='收起评价'
        className='text-sm leading-6 text-gray-700 dark:text-gray-300'
        buttonClassName={`mt-2 ${buttonStyles.quickAction}`}
      />
    </div>
  );
}

function AllReviews() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AdminVideoReview[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminVideoReview | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const requestId = useRef(0);
  const deleteInFlight = useRef(false);
  const deletedKeys = useRef(new Set<string>());
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const query = search.trim();

  const loadPage = useCallback(
    async (q: string, cursor: string | null) => {
      const id = ++requestId.current;
      setLoading(true);
      setFailed(false);
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (cursor) params.set('cursor', cursor);

      try {
        const page = await adminGet<AdminVideoReviewPage>(
          `/api/admin/reviews${params.toString() ? `?${params}` : ''}`,
          '加载评价失败',
        );
        if (id !== requestId.current) return;
        setItems((previous) => {
          const rows = cursor ? [...previous, ...page.items] : page.items;
          return Array.from(
            new Map(
              rows
                .filter((row) => !deletedKeys.current.has(reviewKey(row)))
                .map((row) => [reviewKey(row), row]),
            ).values(),
          );
        });
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (id !== requestId.current) return;
        setFailed(true);
        showError(
          error instanceof Error ? error.message : '加载评价失败',
          showAlert,
        );
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [showAlert],
  );

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setLoading(true);
    setFailed(false);
    const timer = window.setTimeout(
      () => {
        void loadPage(query, null);
      },
      query ? 300 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [query, loadPage]);

  const deleteReview = async () => {
    if (!pendingDelete || deleteInFlight.current) return;
    const review = pendingDelete;
    deleteInFlight.current = true;
    setDeleting(true);
    try {
      await adminDelete(
        '/api/admin/reviews',
        {
          username: review.username,
          title_norm: review.title_norm,
          year: review.year,
        },
        '删除评价失败',
      );
      const key = reviewKey(review);
      // 在途分页响应也要过滤已删除行，避免迟到响应将其重新放回列表。
      deletedKeys.current.add(key);
      setItems((previous) =>
        previous.filter((item) => reviewKey(item) !== key),
      );
    } catch (error) {
      showError(
        error instanceof Error ? error.message : '删除评价失败',
        showAlert,
      );
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  };

  return (
    <div className='space-y-6'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h2 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            评价管理
          </h2>
          <p className='mt-1 text-sm text-gray-500 dark:text-gray-400'>
            管理用户公开的评分与评价
          </p>
        </div>
        <div className='relative w-full sm:max-w-xs'>
          <Search
            aria-hidden='true'
            className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400'
          />
          <input
            type='search'
            aria-label='搜索标题或用户名'
            placeholder='搜索标题或用户名'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`w-full pl-9 text-sm ${inputStyles.withFocus}`}
          />
        </div>
      </div>

      <div
        aria-busy={loading}
        className='overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700'
      >
        {items.length > 0 && (
          <ul
            aria-label='公开评价'
            className='divide-y divide-gray-200 dark:divide-gray-700'
          >
            {items.map((review) => (
              <li key={reviewKey(review)} className='flex gap-3 p-4 sm:gap-4'>
                <div className='relative h-20 w-14 shrink-0 overflow-hidden rounded-md bg-gray-200 dark:bg-gray-800 sm:h-24 sm:w-16'>
                  <CoverImage
                    src={review.cover}
                    alt={`${review.title}封面`}
                    sizes='64px'
                  />
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div className='min-w-0 flex-1'>
                      <h3 className='break-words font-medium text-gray-900 dark:text-gray-100'>
                        {review.title}
                        {review.year && (
                          <span className='ml-2 text-sm font-normal text-gray-500 dark:text-gray-400'>
                            ({review.year})
                          </span>
                        )}
                      </h3>
                      <p className='mt-1 break-all text-sm text-gray-500 dark:text-gray-400'>
                        {review.author.nickname ?? '未设置昵称'}（
                        {review.username}）
                      </p>
                    </div>
                    <button
                      type='button'
                      aria-label={`删除 ${review.username} 对 ${review.title} 的评价`}
                      disabled={deleting}
                      onClick={() => setPendingDelete(review)}
                      className={`${deleting ? buttonStyles.disabledSmall : buttonStyles.roundedDanger} inline-flex shrink-0 items-center gap-1`}
                    >
                      <Trash2 aria-hidden='true' className='h-3.5 w-3.5' />
                      删除
                    </button>
                  </div>
                  <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1'>
                    {review.rating === null ? (
                      <RatingStars value={null} size='sm' />
                    ) : (
                      <span className='inline-flex items-center gap-1.5'>
                        <RatingStars value={review.rating} size='sm' />
                        <span className='text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400'>
                          {formatRating(review.rating)}
                        </span>
                      </span>
                    )}
                    <time
                      dateTime={new Date(review.updated_at).toISOString()}
                      className='text-xs text-gray-500 dark:text-gray-400'
                    >
                      更新于 {formatRelativeTime(review.updated_at)}
                    </time>
                  </div>
                  <ReviewContent content={review.content} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {loading && (
          <div
            role='status'
            className='flex min-h-32 items-center justify-center text-sm text-gray-500 dark:text-gray-400'
          >
            <Loader2
              aria-hidden='true'
              className='mr-2 h-4 w-4 animate-spin text-brand-500'
            />
            加载中...
          </div>
        )}
        {!loading && !failed && items.length === 0 && (
          <p className='py-12 text-center text-sm text-gray-500 dark:text-gray-400'>
            {query ? '暂无匹配的公开评价' : '暂无公开评价'}
          </p>
        )}
        {!loading && (failed || nextCursor) && (
          <div className='flex justify-center p-4'>
            <button
              type='button'
              onClick={() => void loadPage(query, nextCursor)}
              className={buttonStyles.secondary}
            >
              {failed ? '重新加载' : '加载更多'}
            </button>
          </div>
        )}
      </div>
      <ConfirmModal
        isOpen={pendingDelete !== null}
        title='删除评价'
        message={
          pendingDelete
            ? `确认删除 ${pendingDelete.username} 对《${pendingDelete.title}》的评价？删除后无法恢复。`
            : ''
        }
        confirmText='确认删除'
        danger
        confirmDisabled={deleting}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void deleteReview()}
      />
      <AlertModal {...alertModal} onClose={hideAlert} />
    </div>
  );
}

export default function ReviewsTab() {
  const [tab, setTab] = useState<'all' | 'reports'>('all');
  const [pendingTotal, setPendingTotal] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    getAdminReviewReports()
      .then((page) => {
        if (active) setPendingTotal(page.pendingTotal);
      })
      .catch(() => {
        if (active) setPendingTotal(null);
      });
    return () => {
      active = false;
    };
  }, [tab]);
  return (
    <div className='space-y-5'>
      <div
        role='tablist'
        aria-label='评价管理视图'
        className='flex flex-wrap gap-2'
      >
        <button
          type='button'
          role='tab'
          aria-selected={tab === 'all'}
          className={
            tab === 'all' ? buttonStyles.primary : buttonStyles.secondary
          }
          onClick={() => setTab('all')}
        >
          全部评价
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={tab === 'reports'}
          className={
            tab === 'reports' ? buttonStyles.primary : buttonStyles.secondary
          }
          onClick={() => setTab('reports')}
        >
          举报待处理 ({pendingTotal ?? '—'})
        </button>
      </div>
      {tab === 'all' ? (
        <AllReviews />
      ) : (
        <ReviewReports onCountChanged={setPendingTotal} />
      )}
    </div>
  );
}
