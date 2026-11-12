'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import ModalShell from '@/components/modals/ModalShell';
import { type ReviewReportReason, REVIEW_REPORT_REASONS } from '@/lib/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

export const REPORT_REASON_LABELS: Record<ReviewReportReason, string> = {
  spoiler: '未标注剧透',
  abuse: '辱骂或人身攻击',
  spam: '广告或垃圾内容',
  illegal: '违法违规内容',
  other: '其他',
};

const DETAIL_MAX_LENGTH = 200;

export default function ReportDialog({
  isOpen,
  title,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (reason: ReviewReportReason, detail: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<ReviewReportReason>('spoiler');
  const [detail, setDetail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) setError('');
  }, [isOpen]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError('');
    try {
      await onSubmit(reason, detail.trim());
      setDetail('');
    } catch (submitError) {
      if (!isAbortError(submitError))
        setError(getErrorMessage(submitError, '操作失败，请稍后重试'));
    } finally {
      setSending(false);
    }
  }

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={() => {
        if (!sending) onClose();
      }}
      panelClassName='max-w-md p-6'
    >
      <form
        onSubmit={submit}
        role='dialog'
        aria-modal='true'
        aria-label={title}
      >
        <div className='mb-4 flex items-center justify-between'>
          <h3 className='font-semibold'>{title}</h3>
          <button
            type='button'
            aria-label='关闭举报'
            disabled={sending}
            onClick={onClose}
          >
            <X className='h-5 w-5' />
          </button>
        </div>
        <fieldset disabled={sending} className='space-y-3'>
          <legend className='sr-only'>举报原因</legend>
          {REVIEW_REPORT_REASONS.map((value) => (
            <label key={value} className='flex items-center gap-2 text-sm'>
              <input
                type='radio'
                name='report-reason'
                checked={reason === value}
                onChange={() => setReason(value)}
                className='border-0 p-0 text-brand-600 ring-1 ring-gray-300 focus:ring-0'
              />
              {REPORT_REASON_LABELS[value]}
            </label>
          ))}
        </fieldset>
        <textarea
          aria-label='举报说明'
          placeholder={`补充说明（可选，最多 ${DETAIL_MAX_LENGTH} 字）`}
          value={detail}
          maxLength={DETAIL_MAX_LENGTH}
          disabled={sending}
          onChange={(event) => setDetail(event.target.value)}
          className='mt-4 min-h-24 w-full rounded-xl border-0 bg-gray-100 p-3 text-sm focus:ring-0 dark:bg-white/10'
        />
        <p className='text-right text-xs text-gray-500'>
          {detail.length}/{DETAIL_MAX_LENGTH}
        </p>
        {error && (
          <p role='alert' className='text-sm text-red-500'>
            {error}
          </p>
        )}
        <button
          type='submit'
          disabled={sending}
          className='mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm text-white disabled:opacity-50'
        >
          {sending ? '提交中…' : '提交举报'}
        </button>
      </form>
    </ModalShell>
  );
}
