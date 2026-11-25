'use client';

import { Heart, ListVideo, Plus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import {
  LIBRARY_PILL_BUTTON_CLASS,
  LibraryPageFrame,
} from '@/components/LibraryPage';
import {
  ListEmptySkeleton,
  ListEmptyState,
  ListLoadingState,
} from '@/components/ListState';
import LoadErrorState from '@/components/LoadErrorState';
import { LIST_MAX_COUNT } from '@/features/lists/lib/limits';
import {
  createList,
  fetchMyLists,
  fetchSavedLists,
  setListLiked,
} from '@/features/lists/lib/lists-client';
import {
  type ListSummary,
  type SavedListSummary,
  SAVED_LIST_LIMIT,
} from '@/features/lists/types';
import {
  readListCountCookie,
  writeListCountCookie,
} from '@/lib/list-count-cookies';
import { showToast } from '@/lib/toast';
import {
  DisplayableError,
  getErrorMessage,
  isAbortError,
} from '@/lib/user-facing-error';

import { ListGrid, ListGridSkeleton, SavedListGrid } from './ListCard';
import {
  type ListFormValues,
  ListFormDialog,
  NEW_LIST_VALUES,
} from './ListFormDialog';
import { ListPillSwitch } from './ListPillSwitch';

const EMPTY_FRAME_CLASS = 'px-6 py-20 text-center';
const TABS = [
  ['created', '创建的'],
  ['saved', '收藏的'],
] as const;
type ListTab = (typeof TABS)[number][0];
type CountProps = {
  skeletonCount?: number | null;
  savedSkeletonCount?: number | null;
};

function savedWindowCount(count: number | null) {
  return count === null ? null : Math.min(count, SAVED_LIST_LIMIT);
}

function useListTab(): ListTab {
  return useSearchParams()?.get('tab') === 'saved' ? 'saved' : 'created';
}

function ListTabs({
  tab,
  counts,
}: {
  tab: ListTab;
  counts: Record<ListTab, number | null>;
}) {
  function change(next: ListTab) {
    if (next === tab) return;
    const url = new URL(window.location.href);
    if (next === 'saved') url.searchParams.set('tab', next);
    else url.searchParams.delete('tab');
    window.history.pushState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  return (
    <ListPillSwitch
      label='我的片单分类'
      options={TABS.map(([value, label]) => ({
        value,
        label,
        count: counts[value],
      }))}
      value={tab}
      onChange={change}
    />
  );
}

function CreateListButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      disabled={disabled}
      onClick={onClick}
      className={`${LIBRARY_PILL_BUTTON_CLASS} gap-1.5 disabled:pointer-events-none disabled:opacity-40`}
    >
      <Plus aria-hidden='true' className='h-4 w-4' />
      新建片单
    </button>
  );
}

function ListsFrame({
  tab,
  counts,
  action,
  children,
}: {
  tab: ListTab;
  counts: Record<ListTab, number | null>;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <LibraryPageFrame
      title='我的片单'
      toolbar={
        <div className='flex min-h-9 items-center justify-between gap-3'>
          <ListTabs tab={tab} counts={counts} />
          {action}
        </div>
      }
    >
      {children}
    </LibraryPageFrame>
  );
}

function ListsPlaceholder({
  count,
  savedTab,
}: {
  count: number | null;
  savedTab: boolean;
}) {
  if (count !== null && count > 0) return <ListGridSkeleton count={count} />;
  return (
    <div className={EMPTY_FRAME_CLASS}>
      {count === 0 ? <ListEmptySkeleton /> : <ListLoadingState />}
      {savedTab && (
        <div aria-hidden='true' className='mt-5 flex h-9 justify-center'>
          {count === 0 && <span className='skeleton h-9 w-28 rounded-full' />}
        </div>
      )}
    </div>
  );
}

function noop() {}

export function MyListsPageSkeleton({
  skeletonCount = null,
  savedSkeletonCount = null,
}: CountProps) {
  const tab = useListTab();
  const count =
    tab === 'saved' ? savedWindowCount(savedSkeletonCount) : skeletonCount;
  return (
    <ListsFrame
      tab={tab}
      counts={{ created: skeletonCount, saved: savedSkeletonCount }}
      action={
        tab === 'created' ? (
          <CreateListButton disabled onClick={noop} />
        ) : undefined
      }
    >
      <ListsPlaceholder count={count} savedTab={tab === 'saved'} />
    </ListsFrame>
  );
}

export function MyListsPageClient({
  skeletonCount = null,
  savedSkeletonCount = null,
}: CountProps) {
  const tab = useListTab();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [saved, setSaved] = useState<SavedListSummary[] | null>(null);
  const [cookieCounts, setCookieCounts] = useState({
    created: skeletonCount,
    saved: savedSkeletonCount,
  });
  const [errors, setErrors] = useState({ created: '', saved: '' });
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState<ListFormValues | null>(null);
  const removing = useRef(new Set<string>());
  const savedRefresh = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const current = tab === 'saved' ? saved : lists;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      savedRefresh.current?.abort();
    };
  }, []);

  useEffect(() => {
    const created = readListCountCookie('list_count');
    const saved = readListCountCookie('saved_list_count');
    // 服务端补算的计数回写 cookie，下次路由 loading 即可按真实条数渲染。
    if (created === null && skeletonCount !== null)
      writeListCountCookie('list_count', skeletonCount);
    if (saved === null && savedSkeletonCount !== null)
      writeListCountCookie('saved_list_count', savedSkeletonCount);
    setCookieCounts((previous) => ({
      created: created ?? previous.created,
      saved: saved ?? previous.saved,
    }));
  }, [skeletonCount, savedSkeletonCount]);

  useEffect(() => {
    if (current !== null) return;
    const controller = new AbortController();
    setErrors((previous) => ({ ...previous, [tab]: '' }));
    const load = async () => {
      try {
        if (tab === 'saved') {
          const value = await fetchSavedLists(controller.signal);
          if (!controller.signal.aborted) {
            setSaved(value);
            writeListCountCookie('saved_list_count', value.length);
          }
        } else {
          const value = await fetchMyLists(undefined, controller.signal);
          if (!controller.signal.aborted) setLists(value);
        }
      } catch (error) {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setErrors((previous) => ({
            ...previous,
            [tab]: getErrorMessage(error, '加载失败'),
          }));
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [tab, current, reloadKey]);

  useEffect(() => {
    if (lists !== null) writeListCountCookie('list_count', lists.length);
  }, [lists]);

  const openCreate = () => setCreating(NEW_LIST_VALUES);
  async function create(values: ListFormValues) {
    const created = await createList(values);
    setLists((previous) => [created, ...(previous ?? [])]);
    setCreating(null);
  }
  async function unsave(item: SavedListSummary) {
    if (removing.current.has(item.id)) return;
    removing.current.add(item.id);
    savedRefresh.current?.abort();
    setSaved(
      (previous) => previous?.filter((entry) => entry.id !== item.id) ?? null,
    );
    try {
      await setListLiked(item.id, false);
    } catch (error) {
      // 其他页面已取消的记录同样保持移除结果。
      if (!(error instanceof DisplayableError && error.status === 404)) {
        setSaved((previous) =>
          [...(previous ?? []), item].sort((a, b) => b.savedAt - a.savedAt),
        );
        showToast(getErrorMessage(error, '取消收藏失败，请稍后重试'), 'error');
      }
    } finally {
      removing.current.delete(item.id);
    }
    if (!mounted.current || removing.current.size > 0) return;
    // 收藏列表是最近 500 条窗口；所有取消完成后补齐窗口，保留当前内容。
    // 写接口已设置真实计数 Cookie，本地乐观移除不覆盖它。
    const controller = new AbortController();
    savedRefresh.current = controller;
    try {
      const value = await fetchSavedLists(controller.signal);
      if (!controller.signal.aborted) {
        setSaved(value);
        writeListCountCookie('saved_list_count', value.length);
      }
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) {
        showToast(
          getErrorMessage(error, '收藏列表刷新失败，请稍后重试'),
          'error',
        );
      }
    }
  }

  const loading = current === null;
  const counts = {
    created: lists?.length ?? cookieCounts.created,
    saved: saved?.length ?? cookieCounts.saved,
  };
  const count =
    tab === 'saved' ? savedWindowCount(counts.saved) : counts.created;
  return (
    <>
      <ListsFrame
        tab={tab}
        counts={counts}
        action={
          tab === 'created' ? (
            <CreateListButton
              disabled={loading || (lists?.length ?? 0) >= LIST_MAX_COUNT}
              onClick={openCreate}
            />
          ) : undefined
        }
      >
        {errors[tab] ? (
          <LoadErrorState
            message={errors[tab]}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        ) : loading ? (
          <ListsPlaceholder count={count} savedTab={tab === 'saved'} />
        ) : current.length === 0 ? (
          <div className={EMPTY_FRAME_CLASS}>
            <ListEmptyState
              icon={tab === 'saved' ? <Heart /> : <ListVideo />}
              label={tab === 'saved' ? '还没有收藏的片单' : '还没有片单'}
            />
            {tab === 'saved' && (
              <div className='mt-5 flex h-9 justify-center'>
                <Link href='/lists' className={LIBRARY_PILL_BUTTON_CLASS}>
                  去片单广场
                </Link>
              </div>
            )}
          </div>
        ) : tab === 'saved' ? (
          <SavedListGrid
            lists={saved!}
            onUnsave={(item) => void unsave(item)}
          />
        ) : (
          <ListGrid lists={lists!} showPrivacy />
        )}
      </ListsFrame>
      <ListFormDialog
        mode='create'
        initial={creating}
        onClose={() => setCreating(null)}
        onSubmit={create}
      />
    </>
  );
}
