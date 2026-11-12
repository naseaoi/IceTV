'use client';

import {
  ArrowLeft,
  ArrowUpDown,
  Clapperboard,
  Link2,
  Lock,
  Pencil,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import ExpandableText from '@/components/ExpandableText';
import {
  LIBRARY_PILL_BUTTON_CLASS,
  LIBRARY_STICKY_TOOLBAR_CLASS,
  LIBRARY_TOOLBAR_BUTTON_CLASS,
  LibraryEmptyState,
} from '@/components/LibraryPage';
import LoadErrorState from '@/components/LoadErrorState';
import ConfirmModal from '@/components/modals/ConfirmModal';
import MoreMenu from '@/components/MoreMenu';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import PageLayout from '@/components/PageLayout';
import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';
import ProfileAvatar from '@/components/ProfileAvatar';
import SkeletonText from '@/components/SkeletonText';
import { listUrl } from '@/features/lists/lib/list-links';
import {
  deleteList,
  fetchList,
  peekListSummary,
  removeListItem,
  reorderListItems,
  updateList,
} from '@/features/lists/lib/lists-client';
import type { ListDetail, ListItem, ListSummary } from '@/features/lists/types';
import { useBackNavigation } from '@/hooks/useBackNavigation';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';
import { copyTextToClipboard } from '@/lib/clipboard';
import { showToast } from '@/lib/toast';
import type { PublicUserRef } from '@/lib/types';
import {
  DisplayableError,
  getErrorMessage,
  isAbortError,
} from '@/lib/user-facing-error';

import { type ListFormValues, ListFormDialog } from './ListFormDialog';
import {
  EditableListItemCard,
  ListItemCard,
  ListItemGridSkeleton,
} from './ListItemCard';

const NAME_CLASS = 'text-2xl leading-8 sm:text-[28px] sm:leading-9';
const META_CLASS = 'mt-2 text-sm leading-5';
const SKELETON_ITEM_COUNT = 12;
const ACTIONS_CLASS = 'flex shrink-0 items-center gap-1 pt-0.5';
const ICON_BUTTON_CLASS =
  'flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-900/[0.06] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-white';

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detail: ListDetail };

function isMissing(error: unknown) {
  return error instanceof DisplayableError && error.status === 404;
}

export function ListDetailPageClient({ listId }: { listId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [editingInfo, setEditingInfo] = useState<ListFormValues | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 编辑模式下的草稿顺序，完成时一次提交；null 表示未在编辑
  const [draft, setDraft] = useState<ListItem[] | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchList(listId, controller.signal)
      .then((detail) => setState({ status: 'ready', detail }))
      .catch((error) => {
        if (isAbortError(error)) return;
        setState(
          isMissing(error)
            ? { status: 'missing' }
            : { status: 'error', message: getErrorMessage(error, '加载失败') },
        );
      });
    return () => controller.abort();
  }, [listId, reloadKey]);

  const detail = state.status === 'ready' ? state.detail : null;
  // 从列表页进入时已有摘要，加载期间先渲染标题并按条目数铺骨架
  const summary = state.status === 'loading' ? peekListSummary(listId) : null;

  function patchDetail(update: (current: ListDetail) => ListDetail) {
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', detail: update(current.detail) }
        : current,
    );
  }

  async function saveInfo(values: ListFormValues) {
    const list = await updateList(listId, values);
    patchDetail((current) => ({ ...current, list }));
    setEditingInfo(null);
  }

  async function removeList() {
    try {
      await deleteList(listId);
    } catch (error) {
      if (!isAbortError(error)) {
        showToast(getErrorMessage(error, '删除失败，请稍后重试'), 'error');
      }
      throw error;
    }
    router.replace('/me/lists');
  }

  async function removeItem(itemId: string) {
    try {
      const list = await removeListItem(listId, itemId);
      patchDetail((current) => ({
        ...current,
        list,
        items: current.items.filter((item) => item.id !== itemId),
      }));
      showToast('已移出片单', 'success');
    } catch (error) {
      if (!isAbortError(error)) {
        showToast(getErrorMessage(error, '移出失败，请稍后重试'), 'error');
      }
    }
  }

  async function copyLink() {
    const ok = await copyTextToClipboard(
      `${window.location.origin}${listUrl(listId)}`,
    );
    if (ok) showToast('已复制片单链接', 'success');
    else showToast('复制失败，请手动复制地址栏中的链接', 'error');
  }

  async function commitDraft() {
    if (!detail || !draft || savingDraft) return;
    const keep = new Set(draft.map((item) => item.id));
    const removed = detail.items.filter((item) => !keep.has(item.id));
    const remaining = detail.items
      .filter((item) => keep.has(item.id))
      .map((item) => item.id);
    const reordered = draft.some((item, index) => item.id !== remaining[index]);
    if (removed.length === 0 && !reordered) {
      setDraft(null);
      return;
    }
    setSavingDraft(true);
    let list: ListSummary = detail.list;
    const removedIds = new Set<string>();
    try {
      for (const item of removed) {
        list = await removeListItem(listId, item.id);
        removedIds.add(item.id);
      }
      if (reordered) {
        list = await reorderListItems(
          listId,
          draft.map((item) => item.id),
          list.version,
        );
      }
      patchDetail((current) => ({ ...current, list, items: draft }));
      setDraft(null);
    } catch (error) {
      if (isAbortError(error)) return;
      // 已成功移出的条目保留移出结果，其余改动留在草稿里可重试
      patchDetail((current) => ({
        ...current,
        list,
        items: current.items.filter((item) => !removedIds.has(item.id)),
      }));
      if (error instanceof DisplayableError && error.status === 409) {
        showToast('片单已在其他页面修改，已重新加载', 'error');
        setDraft(null);
        setReloadKey((value) => value + 1);
      } else {
        showToast(getErrorMessage(error, '保存失败，请稍后重试'), 'error');
      }
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <PageLayout
      activePath='/me'
      mobileHeader={{ title: '片单', showBack: true }}
    >
      <div className={`${PAGE_CONTAINER_CLASS} pb-12 pt-4 sm:pt-8`}>
        {state.status === 'loading' && <ListDetailSkeleton summary={summary} />}
        {state.status === 'missing' && (
          <LibraryEmptyState
            icon={Clapperboard}
            title='片单不存在或未公开'
            action={
              <Link href='/' className={LIBRARY_PILL_BUTTON_CLASS}>
                返回首页
              </Link>
            }
          />
        )}
        {state.status === 'error' && (
          <LoadErrorState
            message={state.message}
            onRetry={() => {
              setState({ status: 'loading' });
              setReloadKey((value) => value + 1);
            }}
          />
        )}
        {detail && (
          <>
            <ListHeader
              list={detail.list}
              owner={detail.owner}
              actions={
                <ListActions
                  detail={detail}
                  editing={draft !== null}
                  onCopyLink={() => void copyLink()}
                  onEditInfo={() =>
                    setEditingInfo({
                      name: detail.list.name,
                      description: detail.list.description,
                      isPublic: detail.list.isPublic,
                    })
                  }
                  onEditItems={() => setDraft(detail.items)}
                  onDelete={() => setConfirmingDelete(true)}
                />
              }
            />
            {draft !== null && (
              <div className={LIBRARY_STICKY_TOOLBAR_CLASS}>
                <span className='min-w-0 flex-1 text-sm tabular-nums text-gray-500 dark:text-gray-400'>
                  {draft.length} 部
                </span>
                <button
                  type='button'
                  disabled={savingDraft}
                  onClick={() => setDraft(null)}
                  className={LIBRARY_TOOLBAR_BUTTON_CLASS}
                >
                  取消
                </button>
                <button
                  type='button'
                  disabled={savingDraft}
                  onClick={() => void commitDraft()}
                  className={`${LIBRARY_PILL_BUTTON_CLASS} disabled:opacity-50`}
                >
                  完成
                </button>
              </div>
            )}
            <ListItems
              detail={detail}
              draft={draft}
              busy={savingDraft}
              onDraftChange={setDraft}
              onRemoveItem={removeItem}
            />
          </>
        )}
      </div>
      <ListFormDialog
        mode='edit'
        initial={editingInfo}
        onClose={() => setEditingInfo(null)}
        onSubmit={saveInfo}
      />
      <ConfirmModal
        isOpen={confirmingDelete}
        title='删除片单？'
        message={detail ? `「${detail.list.name}」将被删除` : undefined}
        confirmText='删除'
        cancelText='取消'
        danger
        onClose={() => setConfirmingDelete(false)}
        onConfirm={removeList}
      />
    </PageLayout>
  );
}

function ListActions({
  detail,
  editing,
  onCopyLink,
  onEditInfo,
  onEditItems,
  onDelete,
}: {
  detail: ListDetail;
  editing: boolean;
  onCopyLink: () => void;
  onEditInfo: () => void;
  onEditItems: () => void;
  onDelete: () => void;
}) {
  const { list, isOwner } = detail;
  return (
    <>
      {(list.isPublic || isOwner) && (
        <button
          type='button'
          aria-label='复制片单链接'
          title='复制片单链接'
          onClick={onCopyLink}
          className={ICON_BUTTON_CLASS}
        >
          <Link2 className='h-[18px] w-[18px]' />
        </button>
      )}
      {isOwner && !editing && (
        <MoreMenu
          label='片单操作'
          triggerClassName={ICON_BUTTON_CLASS}
          items={[
            { label: '编辑信息', icon: Pencil, onSelect: onEditInfo },
            {
              label: '排序与移出',
              icon: ArrowUpDown,
              onSelect: onEditItems,
              disabled: detail.items.length === 0,
            },
            {
              label: '删除片单',
              icon: Trash2,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        />
      )}
    </>
  );
}

// 窄屏顶栏已带返回，这里只补桌面端
function DesktopBackButton() {
  const goBack = useBackNavigation();
  return (
    <button
      type='button'
      aria-label='返回'
      title='返回'
      onClick={goBack}
      className={`${ICON_BUTTON_CLASS} -ml-2 hidden shrink-0 md:flex`}
    >
      <ArrowLeft className='h-5 w-5' />
    </button>
  );
}

// owner 为 null 时处于加载中，只有作者信息与操作按钮占位
function ListHeader({
  list,
  owner,
  actions,
}: {
  list: ListSummary;
  owner: PublicUserRef | null;
  actions?: ReactNode;
}) {
  return (
    <header className='mb-6 sm:mb-8'>
      <div className='flex items-start gap-3'>
        <DesktopBackButton />
        <h1
          className={`${NAME_CLASS} min-w-0 flex-1 break-words font-semibold text-gray-900 dark:text-gray-50`}
        >
          {list.name}
        </h1>
        <div className={ACTIONS_CLASS}>
          {actions ?? <span aria-hidden='true' className='h-9' />}
        </div>
      </div>
      <div
        className={`${META_CLASS} flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400`}
      >
        {owner ? (
          <Link
            href={`/u/${encodeURIComponent(owner.profileId)}`}
            className='inline-flex items-center gap-1.5 text-gray-700 transition-colors hover:text-brand-600 dark:text-gray-300 dark:hover:text-brand-400'
          >
            <ProfileAvatar user={owner} className='h-5 w-5' />
            {owner.nickname ?? '未设置昵称'}
          </Link>
        ) : (
          <span aria-hidden='true' className='skeleton h-5 w-20 rounded-full' />
        )}
        <span aria-hidden='true'>·</span>
        <span className='tabular-nums'>{list.itemCount} 部</span>
        {!list.isPublic && (
          <>
            <span aria-hidden='true'>·</span>
            <span className='inline-flex items-center gap-1'>
              <Lock aria-hidden='true' className='h-3.5 w-3.5' />
              私密
            </span>
          </>
        )}
      </div>
      {list.description && (
        <ExpandableText
          text={list.description}
          lines={3}
          className='mt-3 max-w-2xl whitespace-pre-line text-sm leading-6 text-gray-600 dark:text-gray-300'
        />
      )}
    </header>
  );
}

function ListItems({
  detail,
  draft,
  busy,
  onDraftChange,
  onRemoveItem,
}: {
  detail: ListDetail;
  draft: ListItem[] | null;
  busy: boolean;
  onDraftChange: (items: ListItem[]) => void;
  onRemoveItem: (itemId: string) => Promise<void>;
}) {
  const items = draft ?? detail.items;
  const keys = useMemo(() => items.map((item) => item.id), [items]);
  const containerRef = useListLayoutMotion<HTMLDivElement>(keys);

  if (items.length === 0) {
    return (
      <LibraryEmptyState
        icon={Clapperboard}
        title={draft ? '已全部移出' : '片单还是空的'}
        action={
          detail.isOwner && !draft ? (
            <Link href='/' className={LIBRARY_PILL_BUTTON_CLASS}>
              去发现
            </Link>
          ) : null
        }
      />
    );
  }

  function move(from: number, to: number) {
    if (!draft || to < 0 || to >= draft.length) return;
    const next = [...draft];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onDraftChange(next);
  }

  return (
    <div
      ref={containerRef}
      aria-busy={busy || undefined}
      inert={busy || undefined}
      className={`relative ${POSTER_GRID_CLASS} ${busy ? 'opacity-60' : ''}`}
    >
      {items.map((item, index) => (
        <div key={item.id} data-list-motion-key={item.id}>
          {draft ? (
            <EditableListItemCard
              item={item}
              index={index}
              total={items.length}
              onMove={move}
              onRemove={() =>
                onDraftChange(draft.filter((entry) => entry.id !== item.id))
              }
            />
          ) : (
            <ListItemCard
              item={item}
              onRemove={
                detail.isOwner ? () => onRemoveItem(item.id) : undefined
              }
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ListDetailSkeleton({ summary }: { summary: ListSummary | null }) {
  if (summary) {
    return (
      <div aria-hidden='true'>
        <ListHeader list={summary} owner={null} />
        {summary.itemCount > 0 && (
          <ListItemGridSkeleton count={summary.itemCount} />
        )}
      </div>
    );
  }
  return (
    <div aria-hidden='true'>
      <div className='mb-6 sm:mb-8'>
        <SkeletonText className={NAME_CLASS} barClassName='h-7 w-48 rounded' />
        <SkeletonText className={META_CLASS} barClassName='h-4 w-40 rounded' />
      </div>
      <ListItemGridSkeleton count={SKELETON_ITEM_COUNT} />
    </div>
  );
}
