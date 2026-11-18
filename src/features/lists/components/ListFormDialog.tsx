'use client';

import { X } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_INPUT_CLASS,
  MODAL_LABEL_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { OptionSwitchRow } from '@/components/OptionSwitchRow';
import {
  LIST_DESCRIPTION_MAX_LENGTH,
  LIST_NAME_MAX_LENGTH,
} from '@/features/lists/lib/limits';
import type { ListVisibility } from '@/features/lists/types';
import { useRetainedValue } from '@/hooks/useRetainedValue';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

export interface ListFormValues {
  name: string;
  description: string;
  visibility: ListVisibility;
}

const EMPTY_VALUES: ListFormValues = {
  name: '',
  description: '',
  visibility: 'private',
};

// initial 为 null 时关闭；有 id 视为编辑
export function ListFormDialog({
  initial,
  mode,
  onClose,
  onSubmit,
}: {
  initial: ListFormValues | null;
  mode: 'create' | 'edit';
  onClose: () => void;
  onSubmit: (values: ListFormValues) => Promise<void>;
}) {
  const retained = useRetainedValue(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <ModalShell
      isOpen={Boolean(initial)}
      onClose={onClose}
      panelClassName='max-w-md'
      initialFocusRef={inputRef}
    >
      {retained && (
        <ListForm
          initial={retained}
          mode={mode}
          inputRef={inputRef}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      )}
    </ModalShell>
  );
}

function ListForm({
  initial,
  mode,
  inputRef,
  onClose,
  onSubmit,
}: {
  initial: ListFormValues;
  mode: 'create' | 'edit';
  inputRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSubmit: (values: ListFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ListFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const title = mode === 'create' ? '新建片单' : '编辑片单';
  const name = values.name.trim();
  const isPublic = values.visibility !== 'private';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !name) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        ...values,
        name,
        description: values.description.trim(),
      });
    } catch (submitError) {
      if (!isAbortError(submitError)) {
        setError(getErrorMessage(submitError, '保存失败，请稍后重试'));
      }
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={title} className='p-5 sm:p-6'>
      <div className='mb-5 flex items-center justify-between'>
        <h2 className={MODAL_TITLE_CLASS}>{title}</h2>
        <button
          type='button'
          aria-label='关闭'
          disabled={saving}
          onClick={onClose}
          className={MODAL_CLOSE_BUTTON_CLASS}
        >
          <X className='h-5 w-5' />
        </button>
      </div>
      <fieldset disabled={saving} className='space-y-4'>
        <div>
          <label htmlFor='list-name' className={MODAL_LABEL_CLASS}>
            名称
          </label>
          <input
            ref={inputRef}
            id='list-name'
            value={values.name}
            maxLength={LIST_NAME_MAX_LENGTH}
            autoComplete='off'
            onChange={(event) =>
              setValues((current) => ({ ...current, name: event.target.value }))
            }
            className={MODAL_INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor='list-description' className={MODAL_LABEL_CLASS}>
            简介
          </label>
          <textarea
            id='list-description'
            value={values.description}
            maxLength={LIST_DESCRIPTION_MAX_LENGTH}
            rows={3}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            className={`${MODAL_INPUT_CLASS} h-auto resize-none py-2.5 leading-relaxed`}
          />
        </div>
        <div>
          <OptionSwitchRow
            label='公开'
            description='展示在个人主页'
            checked={isPublic}
            onChange={(next) =>
              setValues((current) => ({
                ...current,
                visibility: next ? 'members' : 'private',
              }))
            }
            className='w-full'
          />
          {isPublic && (
            <OptionSwitchRow
              label='游客可见'
              description='未登录也能通过链接查看'
              checked={values.visibility === 'everyone'}
              onChange={(next) =>
                setValues((current) => ({
                  ...current,
                  visibility: next ? 'everyone' : 'members',
                }))
              }
              className='w-full'
            />
          )}
        </div>
      </fieldset>
      {error && (
        <p role='alert' className='mt-3 text-sm text-red-500'>
          {error}
        </p>
      )}
      <div className='mt-6 flex justify-end gap-2'>
        <button
          type='button'
          disabled={saving}
          onClick={onClose}
          className={MODAL_SECONDARY_BUTTON_CLASS}
        >
          取消
        </button>
        <button
          type='submit'
          disabled={saving || !name}
          className={MODAL_PRIMARY_BUTTON_CLASS}
        >
          {mode === 'create' ? '创建' : '保存'}
        </button>
      </div>
    </form>
  );
}

export const NEW_LIST_VALUES = EMPTY_VALUES;
