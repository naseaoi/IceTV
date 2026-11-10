'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import Spinner from '@/components/Spinner';
import { AdminUserDanmakuRowsSkeleton } from '@/features/admin/components/AdminContentSkeleton';
import AdminSearchField from '@/features/admin/components/AdminSearchField';
import { ADMIN_PANEL_CLASS } from '@/features/admin/components/AdminSettings';
import { adminDelete, adminGet } from '@/features/admin/lib/api';
import {
  buttonStyles,
  checkboxStyles,
} from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import {
  formatUserDanmakuEpisode,
  formatUserDanmakuTime,
  USER_DANMAKU_ACTION_CLASS,
  USER_DANMAKU_META_CLASS,
  USER_DANMAKU_ROW_CLASS,
  USER_DANMAKU_TEXT_CLASS,
  USER_DANMAKU_TOOLBAR_CLASS,
} from '@/features/admin/lib/user-danmaku-layout';
import { formatRelativeTime } from '@/lib/relative-time';
import {
  type AdminUserDanmakuItem,
  type AdminUserDanmakuPage,
  ADMIN_USER_DANMAKU_DELETE_LIMIT,
} from '@/lib/user-danmaku';
import { DisplayableError, getErrorMessage } from '@/lib/user-facing-error';

const ENDPOINT = '/api/admin/danmaku/user';

export default function UserDanmakuTab() {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<AdminUserDanmakuItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const requestId = useRef(0);
  const deletedIds = useRef(new Set<string>());
  const query = search.trim();

  const loadPage = useCallback(async (q: string, cursor: string | null) => {
    const id = ++requestId.current;
    setLoading(true);
    setFailed(false);
    setLoadError('');
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (cursor) params.set('cursor', cursor);
    try {
      const page = await adminGet<AdminUserDanmakuPage>(
        `${ENDPOINT}${params.toString() ? `?${params}` : ''}`,
        '加载弹幕失败',
      );
      if (id !== requestId.current) return;
      setItems((previous) => {
        const rows = cursor ? [...previous, ...page.items] : page.items;
        const unique = new Map<string, AdminUserDanmakuItem>();
        for (const row of rows) {
          if (!deletedIds.current.has(row.id)) unique.set(row.id, row);
        }
        return [...unique.values()];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (id !== requestId.current) return;
      setFailed(true);
      setLoadError(getErrorMessage(error, '加载弹幕失败'));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    setSelected(new Set());
    setLoading(true);
    setFailed(false);
    setLoadError('');
    const timer = window.setTimeout(
      () => void loadPage(query, null),
      query ? 300 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [query, loadPage]);

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(items.map((item) => item.id)),
    );
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    const ids = pendingDelete;
    setDeleting(true);
    let deleted = 0;
    try {
      for (let i = 0; i < ids.length; i += ADMIN_USER_DANMAKU_DELETE_LIMIT) {
        const batch = ids.slice(i, i + ADMIN_USER_DANMAKU_DELETE_LIMIT);
        await adminDelete(ENDPOINT, { ids: batch }, '删除弹幕失败');
        deleted += batch.length;
        for (const id of batch) deletedIds.current.add(id);
        setItems((previous) =>
          previous.filter((item) => !batch.includes(item.id)),
        );
        setSelected((previous) => {
          const next = new Set(previous);
          for (const id of batch) next.delete(id);
          return next;
        });
        setPendingDelete(ids.slice(deleted));
      }
      setPendingDelete(null);
    } catch {
      showError(
        new DisplayableError(
          `已删除 ${deleted} 条，${ids.length - deleted} 条未删除`,
        ),
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className='space-y-5'>
      {loadError && (
        <p role='alert' className='text-sm text-red-600'>
          {loadError}
        </p>
      )}
      <div className={USER_DANMAKU_TOOLBAR_CLASS}>
        <div className='flex h-9 items-center gap-3'>
          <label className='flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300'>
            <input
              type='checkbox'
              checked={allSelected}
              disabled={items.length === 0}
              onChange={toggleAll}
              className={checkboxStyles}
            />
            {selected.size > 0 ? `已选 ${selected.size} 条` : '全选'}
          </label>
          {selected.size > 0 && (
            <button
              type='button'
              disabled={deleting}
              onClick={() => setPendingDelete([...selected])}
              className={`${buttonStyles.roundedDanger} inline-flex items-center gap-1`}
            >
              <Trash2 aria-hidden='true' className='h-3.5 w-3.5' />
              删除所选
            </button>
          )}
        </div>
        <AdminSearchField
          value={search}
          onChange={setSearch}
          label='搜索弹幕内容或用户名'
          className='w-full sm:w-72'
        />
      </div>

      <div aria-busy={loading} className={ADMIN_PANEL_CLASS}>
        {items.length > 0 && (
          <ul
            aria-label='用户弹幕'
            className='divide-y divide-gray-200 dark:divide-white/[0.06]'
          >
            {items.map((item) => (
              <li key={item.id} className={USER_DANMAKU_ROW_CLASS}>
                <input
                  type='checkbox'
                  aria-label={`选择弹幕：${item.text}`}
                  checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)}
                  className={`${checkboxStyles} shrink-0`}
                />
                <div className='min-w-0 flex-1'>
                  <p
                    className={`${USER_DANMAKU_TEXT_CLASS} break-words text-gray-900 dark:text-gray-100`}
                  >
                    {item.text}
                  </p>
                  <p
                    className={`${USER_DANMAKU_META_CLASS} truncate text-gray-500 dark:text-gray-400`}
                  >
                    {item.username} ·{' '}
                    {formatUserDanmakuEpisode(item.episodeKey)} ·{' '}
                    {formatUserDanmakuTime(item.time)} ·{' '}
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {formatRelativeTime(item.createdAt)}
                    </time>
                  </p>
                </div>
                <button
                  type='button'
                  aria-label={`删除 ${item.username} 的弹幕：${item.text}`}
                  disabled={deleting}
                  onClick={() => setPendingDelete([item.id])}
                  className={`${USER_DANMAKU_ACTION_CLASS} flex shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.08]`}
                >
                  <Trash2 aria-hidden='true' className='h-4 w-4' />
                </button>
              </li>
            ))}
          </ul>
        )}
        {loading && items.length === 0 && <AdminUserDanmakuRowsSkeleton />}
        {loading && items.length > 0 && (
          <div
            role='status'
            className='flex items-center justify-center border-t border-gray-200 py-4 text-sm text-gray-500 dark:border-white/[0.06] dark:text-gray-400'
          >
            <Spinner className='mr-2 h-4 w-4 text-brand-500' />
            加载中...
          </div>
        )}
        {!loading && !failed && items.length === 0 && (
          <p className='py-12 text-center text-sm text-gray-500 dark:text-gray-400'>
            {query ? '没有匹配的弹幕' : '还没有用户发送弹幕'}
          </p>
        )}
        {!loading && (failed || nextCursor) && (
          <div className='flex justify-center border-t border-gray-200 p-4 dark:border-white/[0.06]'>
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
        title='删除弹幕'
        message={
          pendingDelete && pendingDelete.length > 1
            ? `确认删除所选 ${pendingDelete.length} 条弹幕？删除后无法恢复。`
            : '确认删除这条弹幕？删除后无法恢复。'
        }
        confirmText='确认删除'
        danger
        confirmDisabled={deleting}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        onConfirm={() => void confirmDelete()}
      >
        <p>确定删除选中的 {pendingDelete?.length || 0} 条弹幕吗？</p>
      </ConfirmModal>
    </div>
  );
}
