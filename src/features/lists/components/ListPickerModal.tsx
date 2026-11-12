'use client';

import { Check, Plus, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import type { ListPickerTarget } from '@/components/list-picker-context';
import LoadErrorState from '@/components/LoadErrorState';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_INPUT_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import SkeletonText from '@/components/SkeletonText';
import Spinner from '@/components/Spinner';
import {
  LIST_MAX_COUNT,
  LIST_NAME_MAX_LENGTH,
} from '@/features/lists/lib/limits';
import {
  addListItem,
  createList,
  fetchMyLists,
  removeListItem,
} from '@/features/lists/lib/lists-client';
import type { ListItemInput, ListSummary } from '@/features/lists/types';
import { useRetainedValue } from '@/hooks/useRetainedValue';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

import { ListCover } from './ListCard';

const ROW_CLASS = 'flex w-full items-center gap-3 rounded-xl px-2 py-2';
const ROW_COVER_CLASS = 'h-11 w-[78px] shrink-0 rounded-md';
const ROW_NAME_CLASS = 'text-sm leading-5';
const ROW_META_CLASS = 'text-xs leading-4';
const SKELETON_ROWS = 3;

function toItemInput(target: ListPickerTarget): ListItemInput {
  return {
    title: target.title,
    year: target.year ?? '',
    cover: target.cover,
    source: target.source,
    id: target.id,
    ...(target.searchTitle ? { searchTitle: target.searchTitle } : {}),
  };
}

export function ListPickerModal({
  target,
  onClose,
}: {
  target: ListPickerTarget | null;
  onClose: () => void;
}) {
  const retained = useRetainedValue(target);
  return (
    <ModalShell
      isOpen={Boolean(target)}
      onClose={onClose}
      panelClassName='max-w-sm'
    >
      {retained && (
        <ListPicker
          key={`${retained.source}+${retained.id}`}
          target={retained}
          onClose={onClose}
        />
      )}
    </ModalShell>
  );
}

function ListPicker({
  target,
  onClose,
}: {
  target: ListPickerTarget;
  onClose: () => void;
}) {
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoadError('');
    fetchMyLists(
      { title: target.title, year: target.year ?? '' },
      controller.signal,
    )
      .then(setLists)
      .catch((fetchError) => {
        if (!isAbortError(fetchError)) {
          setLoadError(getErrorMessage(fetchError, '加载失败'));
        }
      });
    return () => controller.abort();
  }, [reloadKey, target.title, target.year]);

  const setBusy = useCallback((id: string, busy: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  async function toggle(list: ListSummary) {
    if (pending.has(list.id)) return;
    setBusy(list.id, true);
    setError('');
    try {
      if (list.contains && list.containsItemId) {
        const updated = await removeListItem(list.id, list.containsItemId);
        replaceList({ ...updated, contains: false, containsItemId: null });
      } else {
        const { item, list: updated } = await addListItem(
          list.id,
          toItemInput(target),
        );
        replaceList({ ...updated, contains: true, containsItemId: item.id });
      }
    } catch (toggleError) {
      if (!isAbortError(toggleError)) {
        setError(getErrorMessage(toggleError, '操作失败，请稍后重试'));
      }
    } finally {
      setBusy(list.id, false);
    }
  }

  function replaceList(next: ListSummary) {
    setLists(
      (current) =>
        current?.map((list) => (list.id === next.id ? next : list)) ?? null,
    );
  }

  async function create(name: string) {
    setError('');
    const created = await createList({ name, item: toItemInput(target) });
    // 新建接口不返回条目 ID，重新读取一次以便就地移出
    const refreshed = await fetchMyLists({
      title: target.title,
      year: target.year ?? '',
    }).catch(() => null);
    setLists(
      (current) =>
        refreshed ?? [{ ...created, contains: true }, ...(current ?? [])],
    );
  }

  return (
    <div className='flex max-h-[min(560px,80vh)] flex-col'>
      <div className='flex items-start justify-between gap-3 px-5 pb-3 pt-5'>
        <div className='min-w-0'>
          <h2 className={MODAL_TITLE_CLASS}>加入片单</h2>
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
      <div className='min-h-0 flex-1 overflow-y-auto px-3'>
        {loadError ? (
          <LoadErrorState
            message={loadError}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        ) : lists === null ? (
          <PickerSkeleton />
        ) : (
          <ul aria-label='我的片单'>
            {lists.map((list) => (
              <li key={list.id}>
                <PickerRow
                  list={list}
                  busy={pending.has(list.id)}
                  onToggle={() => void toggle(list)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p role='alert' className='px-5 pt-2 text-sm text-red-500'>
          {error}
        </p>
      )}
      <div className='border-t border-gray-900/[0.06] p-3 dark:border-white/[0.06]'>
        {lists !== null && lists.length < LIST_MAX_COUNT && (
          <CreateListRow autoOpen={lists.length === 0} onCreate={create} />
        )}
      </div>
    </div>
  );
}

function PickerRow({
  list,
  busy,
  onToggle,
}: {
  list: ListSummary;
  busy: boolean;
  onToggle: () => void;
}) {
  const checked = Boolean(list.contains);
  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={checked}
      aria-busy={busy || undefined}
      onClick={onToggle}
      className={`${ROW_CLASS} text-left transition-colors hover:bg-gray-900/[0.04] dark:hover:bg-white/[0.05]`}
    >
      <ListCover
        covers={list.covers}
        title={list.name}
        className={ROW_COVER_CLASS}
      />
      <span className='min-w-0 flex-1'>
        <span
          className={`${ROW_NAME_CLASS} block truncate font-medium text-gray-900 dark:text-gray-100`}
        >
          {list.name}
        </span>
        <span
          className={`${ROW_META_CLASS} mt-0.5 block tabular-nums text-gray-500 dark:text-gray-400`}
        >
          {list.itemCount} 部
        </span>
      </span>
      <span
        aria-hidden='true'
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
          checked
            ? 'bg-brand-500 text-white'
            : 'text-transparent ring-[1.5px] ring-inset ring-gray-300 dark:ring-gray-600'
        }`}
      >
        {busy ? (
          <Spinner
            className={`h-3.5 w-3.5 ${checked ? 'text-white' : 'text-gray-400'}`}
          />
        ) : (
          <Check className='h-3.5 w-3.5' strokeWidth={3} />
        )}
      </span>
    </button>
  );
}

function PickerSkeleton() {
  return (
    <div role='status' aria-label='加载中'>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div key={index} className={ROW_CLASS}>
          <div className={`skeleton ${ROW_COVER_CLASS}`} />
          <div className='min-w-0 flex-1'>
            <SkeletonText
              className={ROW_NAME_CLASS}
              barClassName='h-3.5 w-24 rounded'
            />
            <SkeletonText
              className={`${ROW_META_CLASS} mt-0.5`}
              barClassName='h-3 w-8 rounded'
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateListRow({
  autoOpen,
  onCreate,
}: {
  autoOpen: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(autoOpen);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError('');
    try {
      await onCreate(trimmed);
      setName('');
      setEditing(false);
    } catch (createError) {
      if (!isAbortError(createError)) {
        setError(getErrorMessage(createError, '创建失败，请稍后重试'));
      }
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type='button'
        onClick={() => setEditing(true)}
        className={`${ROW_CLASS} text-sm font-medium text-gray-700 transition-colors hover:bg-gray-900/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.05]`}
      >
        <span className='flex h-6 w-6 items-center justify-center rounded-full bg-gray-900/[0.06] dark:bg-white/[0.08]'>
          <Plus aria-hidden='true' className='h-4 w-4' />
        </span>
        新建片单
      </button>
    );
  }

  return (
    <form onSubmit={submit} className='px-1 py-1'>
      <div className='flex gap-2'>
        <input
          autoFocus
          aria-label='片单名称'
          placeholder='片单名称'
          value={name}
          maxLength={LIST_NAME_MAX_LENGTH}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
          className={MODAL_INPUT_CLASS}
        />
        <button
          type='submit'
          disabled={saving || !name.trim()}
          className='inline-flex h-10 shrink-0 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-50'
        >
          {saving ? <Spinner className='h-4 w-4 text-white' /> : '创建'}
        </button>
      </div>
      {error && (
        <p role='alert' className='mt-2 text-sm text-red-500'>
          {error}
        </p>
      )}
    </form>
  );
}
