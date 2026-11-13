'use client';

import { Mail, X } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_INPUT_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import {
  CAPSULE_DELIVERY_PRESETS,
  createCapsule,
  dateInputDeliverAt,
  formatDeliveryDate,
  presetDeliverAt,
  toDateInputValue,
} from '@/features/time-capsule/lib/capsules-client';
import {
  CAPSULE_CONTENT_MAX_LENGTH,
  CAPSULE_MAX_DELAY_MS,
} from '@/features/time-capsule/types';
import { useRetainedValue } from '@/hooks/useRetainedValue';
import { showToast } from '@/lib/toast';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

export interface CapsuleTarget {
  title: string;
  year: string;
  cover: string;
  source: string;
  videoId: string;
}

type Delivery = { kind: 'preset'; months: number } | { kind: 'custom' };

const CHIP_CLASS =
  'inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors';
const CHIP_IDLE_CLASS = `${CHIP_CLASS} bg-gray-900/[0.05] text-gray-700 hover:bg-gray-900/[0.09] dark:bg-white/[0.07] dark:text-gray-200 dark:hover:bg-white/[0.12]`;
const CHIP_ACTIVE_CLASS = `${CHIP_CLASS} bg-gray-900 text-white dark:bg-white dark:text-gray-900`;
const DAY_MS = 24 * 60 * 60 * 1000;

export function CapsuleComposerModal({
  target,
  onClose,
}: {
  target: CapsuleTarget | null;
  onClose: () => void;
}) {
  const retained = useRetainedValue(target);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  return (
    <ModalShell
      isOpen={Boolean(target)}
      onClose={onClose}
      panelClassName='max-w-md'
      closeOnBackdrop={false}
      initialFocusRef={textareaRef}
    >
      {retained && (
        <CapsuleComposer
          key={`${retained.source}+${retained.videoId}+${retained.title}`}
          target={retained}
          textareaRef={textareaRef}
          onClose={onClose}
        />
      )}
    </ModalShell>
  );
}

function CapsuleComposer({
  target,
  textareaRef,
  onClose,
}: {
  target: CapsuleTarget;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
}) {
  const [content, setContent] = useState('');
  const [delivery, setDelivery] = useState<Delivery>({
    kind: 'preset',
    months: 6,
  });
  const [now] = useState(() => Date.now());
  const [customDate, setCustomDate] = useState(() =>
    toDateInputValue(presetDeliverAt(6, new Date(now))),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const minDate = toDateInputValue(now + DAY_MS);
  const maxDate = toDateInputValue(now + CAPSULE_MAX_DELAY_MS - DAY_MS);
  const deliverAt =
    delivery.kind === 'preset'
      ? presetDeliverAt(delivery.months, new Date(now))
      : dateInputDeliverAt(customDate);
  const trimmed = content.trim();
  const validDate =
    deliverAt !== null && customDate >= minDate && customDate <= maxDate;
  const canSave =
    !saving &&
    trimmed.length > 0 &&
    trimmed.length <= CAPSULE_CONTENT_MAX_LENGTH &&
    (delivery.kind === 'preset' || validDate);

  async function submit() {
    if (!canSave || deliverAt === null) return;
    setSaving(true);
    setError('');
    try {
      await createCapsule({ ...target, content: trimmed, deliverAt });
      showToast(`信已封存，${formatDeliveryDate(deliverAt)}送达`, 'success');
      onClose();
    } catch (submitError) {
      if (!isAbortError(submitError)) {
        setError(getErrorMessage(submitError, '封存失败，请稍后重试'));
      }
      setSaving(false);
    }
  }

  return (
    <form
      className='flex max-h-[min(640px,85vh)] flex-col'
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className='flex items-start justify-between gap-3 px-5 pb-3 pt-5'>
        <div className='min-w-0'>
          <h2 className={MODAL_TITLE_CLASS}>写给未来的自己</h2>
          <p className='mt-0.5 truncate text-[13px] text-gray-500 dark:text-gray-400'>
            {target.title}
          </p>
        </div>
        <button
          type='button'
          aria-label='关闭'
          onClick={onClose}
          className={`${MODAL_CLOSE_BUTTON_CLASS} -mr-1.5`}
        >
          <X className='h-5 w-5' />
        </button>
      </div>
      <div className='min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-1'>
        <div>
          <textarea
            ref={textareaRef}
            value={content}
            disabled={saving}
            maxLength={CAPSULE_CONTENT_MAX_LENGTH}
            onChange={(event) => setContent(event.target.value)}
            rows={6}
            aria-label='信的内容'
            placeholder='此刻的感受、记住的台词，或者想问以后的自己的话'
            className='block w-full resize-none rounded-xl border-0 bg-gray-900/[0.04] px-3.5 py-3 text-sm leading-6 text-gray-900 ring-1 ring-inset ring-gray-900/[0.08] transition-colors placeholder:text-gray-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:opacity-60 dark:bg-white/[0.06] dark:text-gray-100 dark:ring-white/[0.08] dark:placeholder:text-gray-500 dark:focus:bg-gray-900'
          />
          <p className='mt-1 text-right text-[11px] tabular-nums text-gray-400 dark:text-gray-500'>
            {content.length}/{CAPSULE_CONTENT_MAX_LENGTH}
          </p>
        </div>
        <fieldset>
          <legend className='mb-2 text-[13px] font-medium text-gray-700 dark:text-gray-300'>
            送达时间
          </legend>
          <div className='flex flex-wrap gap-2'>
            {CAPSULE_DELIVERY_PRESETS.map((preset) => {
              const active =
                delivery.kind === 'preset' && delivery.months === preset.months;
              return (
                <button
                  key={preset.months}
                  type='button'
                  aria-pressed={active}
                  disabled={saving}
                  onClick={() =>
                    setDelivery({ kind: 'preset', months: preset.months })
                  }
                  className={active ? CHIP_ACTIVE_CLASS : CHIP_IDLE_CLASS}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              type='button'
              aria-pressed={delivery.kind === 'custom'}
              disabled={saving}
              onClick={() => setDelivery({ kind: 'custom' })}
              className={
                delivery.kind === 'custom' ? CHIP_ACTIVE_CLASS : CHIP_IDLE_CLASS
              }
            >
              自定义
            </button>
          </div>
          {delivery.kind === 'custom' && (
            <input
              type='date'
              value={customDate}
              min={minDate}
              max={maxDate}
              disabled={saving}
              aria-label='送达日期'
              onChange={(event) => setCustomDate(event.target.value)}
              className={`${MODAL_INPUT_CLASS} mt-3`}
            />
          )}
          <p className='mt-3 flex items-center gap-1.5 text-[13px] text-gray-500 dark:text-gray-400'>
            <Mail aria-hidden='true' className='h-3.5 w-3.5' />
            {deliverAt !== null && (delivery.kind === 'preset' || validDate)
              ? `${formatDeliveryDate(deliverAt)}送达`
              : '请选择明天之后、5 年以内的日期'}
          </p>
        </fieldset>
        {error && (
          <p role='alert' className='text-[13px] text-red-500'>
            {error}
          </p>
        )}
      </div>
      <div className='flex justify-end gap-2 px-5 pb-5 pt-4'>
        <button
          type='button'
          onClick={onClose}
          disabled={saving}
          className={MODAL_SECONDARY_BUTTON_CLASS}
        >
          取消
        </button>
        <button
          type='submit'
          disabled={!canSave}
          className={MODAL_PRIMARY_BUTTON_CLASS}
        >
          封存
        </button>
      </div>
    </form>
  );
}
