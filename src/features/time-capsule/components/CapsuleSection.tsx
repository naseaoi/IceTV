'use client';

import { ChevronRight, Lock, Trash2, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import ConfirmModal from '@/components/modals/ConfirmModal';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import SkeletonText from '@/components/SkeletonText';
import Spinner from '@/components/Spinner';
import { CapsuleLetter } from '@/features/time-capsule/components/CapsuleLetter';
import {
  CAPSULES_UPDATED_EVENT,
  deleteCapsule,
  fetchCapsules,
  formatDeliveryDate,
  openCapsule,
} from '@/features/time-capsule/lib/capsules-client';
import type {
  CapsulePage,
  DeliveredCapsule,
  PendingCapsule,
} from '@/features/time-capsule/types';
import { useRetainedValue } from '@/hooks/useRetainedValue';
import { showToast } from '@/lib/toast';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

export interface CapsuleCounts {
  pending: number;
  delivered: number;
  unread: number;
}

const DELIVERED_PAGE_SIZE = 50;

// 骨架与真实列表共用
const LIST_CLASS =
  'divide-y divide-gray-900/[0.06] overflow-hidden rounded-2xl bg-white ring-1 ring-gray-900/[0.06] dark:divide-white/[0.06] dark:bg-gray-900 dark:ring-white/[0.08]';
const ROW_CLASS = 'flex w-full items-center gap-3 px-4 py-3 text-left';
const LEAD_CLASS = 'relative h-[60px] w-10 shrink-0 overflow-hidden rounded-md';
const PRIMARY_TEXT_CLASS = 'text-sm leading-5';
const SECONDARY_TEXT_CLASS = 'mt-0.5 text-xs leading-4';
const PREVIEW_TEXT_CLASS = 'mt-1 text-[13px] leading-5';

export function CapsuleSectionSkeleton({ counts }: { counts: CapsuleCounts }) {
  const rows =
    (counts.pending > 0 ? 1 : 0) +
    Math.min(counts.delivered, DELIVERED_PAGE_SIZE);
  if (rows === 0) return null;
  return (
    <div aria-hidden='true' className={LIST_CLASS}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={ROW_CLASS}>
          <div className={`${LEAD_CLASS} skeleton`} />
          <div className='min-w-0 flex-1'>
            <SkeletonText
              className={PRIMARY_TEXT_CLASS}
              barClassName='h-3.5 w-1/3 rounded'
            />
            <SkeletonText
              className={SECONDARY_TEXT_CLASS}
              barClassName='h-3 w-1/4 rounded'
            />
            <SkeletonText
              className={PREVIEW_TEXT_CLASS}
              barClassName='h-3 w-2/3 rounded'
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function useCapsules() {
  const [page, setPage] = useState<CapsulePage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const reload = useCallback((signal?: AbortSignal) => {
    fetchCapsules(null, signal)
      .then(setPage)
      // 辅助区块，读取失败保持现状，等下次写入事件再试
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    const onUpdated = () => reload();
    window.addEventListener(CAPSULES_UPDATED_EVENT, onUpdated);
    return () => {
      controller.abort();
      window.removeEventListener(CAPSULES_UPDATED_EVENT, onUpdated);
    };
  }, [reload]);

  async function loadMore() {
    if (!page?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchCapsules(page.nextCursor);
      setPage((current) =>
        current
          ? {
              pending: current.pending,
              delivered: [...current.delivered, ...next.delivered],
              nextCursor: next.nextCursor,
            }
          : next,
      );
    } catch (error) {
      if (!isAbortError(error))
        showToast(getErrorMessage(error, '加载失败，请重试'), 'error');
    } finally {
      setLoadingMore(false);
    }
  }

  return { page, loadingMore, loadMore };
}

export function CapsuleSection({
  initialCounts,
  renderSection,
}: {
  initialCounts: CapsuleCounts;
  // 全部为空时整个区块（含标题）不渲染，所以外框由调用方传入
  renderSection: (content: ReactNode) => ReactNode;
}) {
  const { page, loadingMore, loadMore } = useCapsules();
  const [reading, setReading] = useState<DeliveredCapsule | null>(null);
  const [showPending, setShowPending] = useState(false);

  if (!page) {
    const empty = initialCounts.pending + initialCounts.delivered === 0;
    return empty
      ? null
      : renderSection(<CapsuleSectionSkeleton counts={initialCounts} />);
  }
  if (page.pending.length === 0 && page.delivered.length === 0) return null;

  function openLetter(capsule: DeliveredCapsule) {
    setReading(capsule);
    // 拆信成功后派发更新事件，列表随之重新读取
    if (capsule.openedAt === null)
      void openCapsule(capsule.id).catch(() => undefined);
  }

  return renderSection(
    <>
      <div className={LIST_CLASS}>
        {page.pending.length > 0 && (
          <PendingRow
            pending={page.pending}
            onClick={() => setShowPending(true)}
          />
        )}
        {page.delivered.map((capsule) => (
          <DeliveredRow
            key={capsule.id}
            capsule={capsule}
            onClick={() => openLetter(capsule)}
          />
        ))}
      </div>
      {page.nextCursor && (
        <div className='flex justify-center pt-2'>
          <button
            type='button'
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className='inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-950/50'
          >
            {loadingMore && <Spinner className='h-3.5 w-3.5' />}
            {loadingMore ? '加载中' : '加载更多'}
          </button>
        </div>
      )}
      <LetterModal capsule={reading} onClose={() => setReading(null)} />
      <PendingModal
        open={showPending}
        pending={page.pending}
        onClose={() => setShowPending(false)}
      />
    </>,
  );
}

function PendingRow({
  pending,
  onClick,
}: {
  pending: PendingCapsule[];
  onClick: () => void;
}) {
  const next = pending[0];
  return (
    <button
      type='button'
      onClick={onClick}
      className={`${ROW_CLASS} transition-colors hover:bg-gray-900/[0.03] dark:hover:bg-white/[0.04]`}
    >
      <div
        className={`${LEAD_CLASS} flex items-center justify-center bg-gray-900/[0.05] text-gray-500 dark:bg-white/[0.07] dark:text-gray-400`}
      >
        <Lock aria-hidden='true' className='h-4 w-4' />
      </div>
      <div className='min-w-0 flex-1'>
        <p
          className={`${PRIMARY_TEXT_CLASS} font-medium text-gray-900 dark:text-gray-100`}
        >
          {pending.length} 封信在路上
        </p>
        <p
          className={`${SECONDARY_TEXT_CLASS} text-gray-500 dark:text-gray-400`}
        >
          最近一封 {formatDeliveryDate(next.deliverAt)}送达
        </p>
        <p
          className={`${PREVIEW_TEXT_CLASS} truncate text-gray-500 dark:text-gray-400`}
        >
          {pending.map((item) => `《${item.title}》`).join('')}
        </p>
      </div>
      <ChevronRight
        aria-hidden='true'
        className='h-4 w-4 shrink-0 text-gray-400'
      />
    </button>
  );
}

function DeliveredRow({
  capsule,
  onClick,
}: {
  capsule: DeliveredCapsule;
  onClick: () => void;
}) {
  const unread = capsule.openedAt === null;
  return (
    <button
      type='button'
      onClick={onClick}
      className={`${ROW_CLASS} transition-colors hover:bg-gray-900/[0.03] dark:hover:bg-white/[0.04]`}
    >
      <div className={`${LEAD_CLASS} bg-gray-100 dark:bg-gray-800`}>
        <CoverImage src={capsule.cover} alt={capsule.title} sizes='40px' />
      </div>
      <div className='min-w-0 flex-1'>
        <p
          className={`${PRIMARY_TEXT_CLASS} flex items-center gap-1.5 font-medium text-gray-900 dark:text-gray-100`}
        >
          <span className='truncate'>{capsule.title}</span>
          {unread && (
            <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500'>
              <span className='sr-only'>未读</span>
            </span>
          )}
        </p>
        <p
          className={`${SECONDARY_TEXT_CLASS} text-gray-500 dark:text-gray-400`}
        >
          {`写于 ${formatDeliveryDate(capsule.createdAt)} · ${formatDeliveryDate(capsule.deliverAt)}送达`}
        </p>
        <p
          className={`${PREVIEW_TEXT_CLASS} truncate text-gray-600 dark:text-gray-300`}
        >
          {capsule.content}
        </p>
      </div>
    </button>
  );
}

function LetterModal({
  capsule,
  onClose,
}: {
  capsule: DeliveredCapsule | null;
  onClose: () => void;
}) {
  const retained = useRetainedValue(capsule);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <ModalShell
        isOpen={Boolean(capsule)}
        onClose={onClose}
        panelClassName='max-w-md'
      >
        {retained && (
          <div className='px-5 pb-5 pt-5'>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <h2 className={MODAL_TITLE_CLASS}>来自过去的信</h2>
              <div className='-mr-1.5 flex items-center gap-1'>
                <button
                  type='button'
                  aria-label='删除这封信'
                  title='删除'
                  onClick={() => setConfirming(true)}
                  className={MODAL_CLOSE_BUTTON_CLASS}
                >
                  <Trash2 className='h-4 w-4' />
                </button>
                <button
                  type='button'
                  aria-label='关闭'
                  onClick={onClose}
                  className={MODAL_CLOSE_BUTTON_CLASS}
                >
                  <X className='h-5 w-5' />
                </button>
              </div>
            </div>
            <CapsuleLetter
              letter={{ ...retained, writtenAt: retained.createdAt }}
              onNavigate={onClose}
            />
          </div>
        )}
      </ModalShell>
      <ConfirmModal
        isOpen={confirming}
        title='删除这封信？'
        confirmText='删除'
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          if (!retained) return;
          try {
            await deleteCapsule(retained.id);
            setConfirming(false);
            onClose();
          } catch (error) {
            showToast(getErrorMessage(error, '删除失败，请重试'), 'error');
            throw error;
          }
        }}
      />
    </>
  );
}

function PendingModal({
  open,
  pending,
  onClose,
}: {
  open: boolean;
  pending: PendingCapsule[];
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState<PendingCapsule | null>(null);
  const retainedDeleting = useRetainedValue(deleting);
  return (
    <>
      <ModalShell isOpen={open} onClose={onClose} panelClassName='max-w-sm'>
        <div className='flex max-h-[min(560px,80vh)] flex-col'>
          <div className='flex items-center justify-between gap-3 px-5 pb-3 pt-5'>
            <h2 className={MODAL_TITLE_CLASS}>在路上的信</h2>
            <button
              type='button'
              aria-label='关闭'
              onClick={onClose}
              className={`${MODAL_CLOSE_BUTTON_CLASS} -mr-1.5`}
            >
              <X className='h-5 w-5' />
            </button>
          </div>
          <ul className='min-h-0 flex-1 overflow-y-auto px-2 pb-3'>
            {pending.map((item) => (
              <li
                key={item.id}
                className='flex items-center gap-3 rounded-xl px-3 py-2.5'
              >
                <div className='relative h-12 w-8 shrink-0 overflow-hidden rounded bg-gray-100 dark:bg-gray-800'>
                  <CoverImage src={item.cover} alt={item.title} sizes='32px' />
                </div>
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {item.title}
                  </p>
                  <p className='mt-0.5 text-xs text-gray-500 dark:text-gray-400'>
                    {formatDeliveryDate(item.deliverAt)}送达
                  </p>
                </div>
                <button
                  type='button'
                  aria-label={`删除关于《${item.title}》的信`}
                  title='删除'
                  onClick={() => setDeleting(item)}
                  className={MODAL_CLOSE_BUTTON_CLASS}
                >
                  <Trash2 className='h-4 w-4' />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </ModalShell>
      <ConfirmModal
        isOpen={Boolean(deleting)}
        title='删除这封信？'
        message={
          retainedDeleting
            ? `关于《${retainedDeleting.title}》的信将不会送达`
            : undefined
        }
        confirmText='删除'
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteCapsule(deleting.id);
            setDeleting(null);
            if (pending.length <= 1) onClose();
          } catch (error) {
            showToast(getErrorMessage(error, '删除失败，请重试'), 'error');
            throw error;
          }
        }}
      />
    </>
  );
}
