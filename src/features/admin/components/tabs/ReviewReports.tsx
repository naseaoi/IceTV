'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import ExpandableText from '@/components/ExpandableText';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { REPORT_REASON_LABELS } from '@/components/PublicReviewContent';
import {
  getAdminReviewReports,
  moderateReviewReport,
} from '@/features/admin/lib/api';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { formatRelativeTime } from '@/lib/relative-time';
import { type AdminReviewReportItem, REVIEW_REPORT_REASONS } from '@/lib/types';

type Action = 'dismiss' | 'mark-spoiler' | 'delete-review';
const ACTION_LABELS: Record<Action, string> = {
  dismiss: '驳回举报',
  'mark-spoiler': '标为剧透',
  'delete-review': '删除评价',
};
export default function ReviewReports({
  onCountChanged,
}: {
  onCountChanged: (count: number) => void;
}) {
  const [items, setItems] = useState<AdminReviewReportItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{
    item: AdminReviewReportItem;
    action: Action;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const request = useRef(0);
  const load = useCallback(
    async (next: string | null) => {
      const id = ++request.current;
      setLoading(true);
      setError('');
      try {
        const page = await getAdminReviewReports(next);
        if (id !== request.current) return;
        setItems((previous) =>
          next ? [...previous, ...page.items] : page.items,
        );
        setCursor(page.nextCursor);
        onCountChanged(page.pendingTotal);
      } catch (error) {
        if (id === request.current) setError((error as Error).message);
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [onCountChanged],
  );
  useEffect(() => {
    const lifecycle = request;
    void load(null);
    return () => {
      lifecycle.current++;
    };
  }, [load]);
  async function moderate() {
    if (!pending || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    try {
      const { review } = pending.item;
      await moderateReviewReport({
        action: pending.action,
        username: review.username,
        title_norm: review.title_norm,
        year: review.year,
      });
      setPending(null);
      await load(null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <div className='space-y-4'>
      {error && (
        <p role='alert' className='text-sm text-red-500'>
          {error}
        </p>
      )}
      {items.map((item) => (
        <article
          key={JSON.stringify([
            item.review.username,
            item.review.title_norm,
            item.review.year,
          ])}
          className='rounded-xl border border-gray-200 p-4 dark:border-gray-700'
        >
          <h3 className='font-semibold text-gray-900 dark:text-gray-100'>
            {item.review.title} {item.review.year}
          </h3>
          <p className='mt-1 text-sm text-gray-500'>
            {item.review.author.nickname ?? '未设置昵称'}（
            {item.review.username}）
          </p>
          <div className='my-3'>
            <ExpandableText
              text={item.review.content || '仅评分'}
              className='text-sm text-gray-700 dark:text-gray-300'
            />
          </div>
          <div className='flex flex-wrap gap-2 text-xs text-gray-500'>
            <span>{item.reportCount} 条举报</span>
            {REVIEW_REPORT_REASONS.filter((reason) => item.reasons[reason]).map(
              (reason) => (
                <span
                  key={reason}
                  className='rounded-full bg-gray-100 px-2 py-1 dark:bg-white/10'
                >
                  {REPORT_REASON_LABELS[reason]} {item.reasons[reason]}
                </span>
              ),
            )}
          </div>
          <ul className='my-4 space-y-2 border-l-2 border-gray-200 pl-3 text-xs text-gray-500 dark:border-gray-700'>
            {item.reports.map((report, index) => (
              <li key={`${report.reporter.profileId}:${index}`}>
                <p>
                  {report.reporter.nickname ?? '未设置昵称'} ·{' '}
                  {REPORT_REASON_LABELS[report.reason]} ·{' '}
                  {formatRelativeTime(report.created_at)}
                </p>
                {report.detail && (
                  <p className='mt-1 break-words text-gray-700 dark:text-gray-300'>
                    {report.detail}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className='flex flex-wrap gap-2'>
            {(Object.keys(ACTION_LABELS) as Action[]).map((action) => (
              <button
                type='button'
                key={action}
                disabled={saving || loading}
                onClick={() => setPending({ item, action })}
                className={
                  action === 'delete-review'
                    ? buttonStyles.danger
                    : buttonStyles.secondary
                }
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
        </article>
      ))}
      {loading && (
        <p role='status' className='py-8 text-center text-sm text-gray-500'>
          加载举报中…
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className='py-12 text-center text-sm text-gray-500'>
          暂无待处理举报
        </p>
      )}
      {!loading && (cursor || error) && (
        <button
          type='button'
          className={buttonStyles.secondary}
          onClick={() => void load(cursor)}
        >
          {error ? '重新加载' : '加载更多'}
        </button>
      )}
      <ConfirmModal
        isOpen={pending !== null}
        title={pending ? ACTION_LABELS[pending.action] : '处理举报'}
        message={
          pending
            ? `确认${ACTION_LABELS[pending.action]}：${pending.item.review.author.nickname ?? '未设置昵称'}对《${pending.item.review.title}》的评价？${pending.action === 'delete-review' ? '删除后无法恢复。' : '此操作将清空该评价的当前举报。'}`
            : ''
        }
        confirmText='确认处理'
        danger={pending?.action === 'delete-review'}
        confirmDisabled={saving}
        onConfirm={() => void moderate()}
        onClose={() => {
          if (!saving) setPending(null);
        }}
      />
    </div>
  );
}
