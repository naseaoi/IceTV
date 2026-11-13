'use client';

import {
  ArrowLeft,
  ArrowUpDown,
  Clapperboard,
  Clock,
  Link2,
  ListVideo,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import { useAuthSession } from '@/components/AuthProvider';
import CoverImage from '@/components/CoverImage';
import ExpandableText from '@/components/ExpandableText';
import {
  LIBRARY_PILL_BUTTON_CLASS,
  LIBRARY_STICKY_TOOLBAR_CLASS,
  LIBRARY_TOOLBAR_BUTTON_CLASS,
  LibraryEmptySkeleton,
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
import WatchLevelBadge from '@/components/WatchLevelBadge';
import { listItemPlayUrl, listUrl } from '@/features/lists/lib/list-links';
import {
  deleteList,
  fetchList,
  peekListSummary,
  removeListItem,
  reorderListItems,
  updateList,
} from '@/features/lists/lib/lists-client';
import type {
  ListDetail,
  ListItem,
  ListSummary,
  ListViewerProgress,
} from '@/features/lists/types';
import { useBackNavigation } from '@/hooks/useBackNavigation';
import { useListLayoutMotion } from '@/hooks/useListLayoutMotion';
import { copyTextToClipboard } from '@/lib/clipboard';
import { formatRelativeTime } from '@/lib/relative-time';
import { showToast } from '@/lib/toast';
import type { PublicUserRef } from '@/lib/types';
import {
  DisplayableError,
  getErrorMessage,
  isAbortError,
} from '@/lib/user-facing-error';
import { VIDEO_REVIEWS_UPDATED_EVENT } from '@/lib/video-reviews';

import { ListCover, ListStats } from './ListCard';
import { type ListFormValues, ListFormDialog } from './ListFormDialog';
import {
  EditableListItemCard,
  ListItemCard,
  ListItemGridSkeleton,
} from './ListItemCard';
import { ListLikeButton } from './ListLikeButton';
import { ListVisibilityBadge } from './ListVisibilityBadge';

// 头部与骨架共用几何类，改动时两侧同步
const HEADER_CLASS = 'relative mb-8 sm:mb-10';
const HEADER_BODY_CLASS = 'relative flex items-end gap-8';
const HEADER_COVER_CLASS =
  'hidden aspect-[16/9] w-72 shrink-0 rounded-2xl shadow-xl shadow-black/25 md:block lg:w-[360px]';
const NAME_CLASS = 'text-2xl leading-8 sm:text-[32px] sm:leading-10';
const DESCRIPTION_CLASS = 'mt-2 text-sm leading-6';
const META_CLASS = 'mt-3 text-sm leading-5';
const ACTIONS_CLASS = 'mt-5 flex h-9 items-center gap-1';
const BACK_BUTTON_CLASS = 'relative -ml-2 mb-3 hidden md:flex';
// 游客只能经分享链接直接进入，返回会落到受保护的「我的片单」，因此不提供返回
const mobileHeader = (authenticated: boolean) => ({
  title: '片单',
  showBack: authenticated,
});
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

export function ListDetailPageClient({
  listId,
  initialItemCount,
}: {
  listId: string;
  // 服务端按当前访客可读性读出的条目数，null 表示未知或不可读
  initialItemCount: number | null;
}) {
  const router = useRouter();
  const authenticated = useAuthSession().session.status === 'authenticated';
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
  }, [listId, reloadKey, authenticated]);

  // 观看状态由收藏与评价推导，卡片菜单里改动后静默刷新进度
  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => setReloadKey((value) => value + 1);
    window.addEventListener('favoritesUpdated', refresh);
    window.addEventListener(VIDEO_REVIEWS_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener('favoritesUpdated', refresh);
      window.removeEventListener(VIDEO_REVIEWS_UPDATED_EVENT, refresh);
    };
  }, [authenticated]);

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

  // 游客读不到的片单可能只对登录用户公开，按受保护页面提示登录
  if (state.status === 'missing' && !authenticated) {
    return (
      <AuthenticatedRoute
        activePath='/me'
        message='请先登录后再查看片单。'
        mobileHeader={mobileHeader(false)}
      >
        {null}
      </AuthenticatedRoute>
    );
  }

  return (
    <PageLayout
      activePath='/me'
      mobileHeader={mobileHeader(authenticated)}
      transparentTopNav
    >
      <div className={`${PAGE_CONTAINER_CLASS} pb-12 pt-4 sm:pt-8`}>
        {state.status === 'loading' && (
          <ListDetailSkeleton
            summary={summary}
            itemCount={summary?.itemCount ?? initialItemCount}
            showBack={authenticated}
          />
        )}
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
              showBack={authenticated}
              actions={
                <ListActions
                  detail={detail}
                  like={
                    <ListLikeButton
                      listId={listId}
                      state={{
                        liked: detail.liked,
                        likeCount: detail.list.likeCount,
                      }}
                      isOwner={detail.isOwner}
                      authenticated={authenticated}
                      onChange={({ liked, likeCount }) =>
                        patchDetail((current) => ({
                          ...current,
                          liked,
                          list: { ...current.list, likeCount },
                        }))
                      }
                    />
                  }
                  editing={draft !== null}
                  onCopyLink={() => void copyLink()}
                  onEditInfo={() =>
                    setEditingInfo({
                      name: detail.list.name,
                      description: detail.list.description,
                      visibility: detail.list.visibility,
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
              guest={!authenticated}
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
  like,
  editing,
  onCopyLink,
  onEditInfo,
  onEditItems,
  onDelete,
}: {
  detail: ListDetail;
  like: ReactNode;
  editing: boolean;
  onCopyLink: () => void;
  onEditInfo: () => void;
  onEditItems: () => void;
  onDelete: () => void;
}) {
  const { list, isOwner } = detail;
  const showLike = list.visibility !== 'private' && !isOwner;
  const progress = editing ? null : detail.viewerProgress;
  const showProgress = Boolean(progress && progress.total > 0);
  return (
    // 首个按钮是图标按钮时左移内边距，让图标与上方文字左对齐
    <div
      className={`flex min-w-0 items-center gap-1 ${showLike || showProgress ? '' : '-ml-2.5'}`}
    >
      {progress && showProgress && (
        <ViewerProgress progress={progress} items={detail.items} />
      )}
      {showLike && like}
      <ListActionButtons
        detail={detail}
        editing={editing}
        onCopyLink={onCopyLink}
        onEditInfo={onEditInfo}
        onEditItems={onEditItems}
        onDelete={onDelete}
      />
    </div>
  );
}

const PROGRESS_RING_RADIUS = 7;
const PROGRESS_RING_LENGTH = 2 * Math.PI * PROGRESS_RING_RADIUS;

function ViewerProgress({
  progress,
  items,
}: {
  progress: ListViewerProgress;
  items: ListItem[];
}) {
  const { completed, total, nextItemId } = progress;
  const next = nextItemId
    ? items.find((item) => item.id === nextItemId)
    : undefined;
  const ratio = Math.min(1, completed / total);
  const label = !next
    ? null
    : next.viewerStatus === 'watching'
      ? '继续看'
      : completed === 0
        ? '开始看'
        : '看下一部';
  return (
    <div className='mr-2 flex min-w-0 items-center gap-3'>
      {next && label && (
        <Link
          href={listItemPlayUrl(next)}
          title={`《${next.title}》`}
          className={`${LIBRARY_PILL_BUTTON_CLASS} shrink-0 gap-1.5 pl-3.5`}
        >
          <Play aria-hidden='true' className='h-4 w-4 fill-current' />
          {label}
        </Link>
      )}
      <span
        className='inline-flex shrink-0 items-center gap-1.5 text-sm tabular-nums text-gray-500 dark:text-gray-400'
        aria-label={`已看 ${completed} 部，共 ${total} 部`}
      >
        <svg
          aria-hidden='true'
          viewBox='0 0 18 18'
          className='h-[18px] w-[18px] -rotate-90'
        >
          <circle
            cx='9'
            cy='9'
            r={PROGRESS_RING_RADIUS}
            fill='none'
            strokeWidth='2.5'
            className='stroke-gray-200 dark:stroke-gray-700'
          />
          <circle
            cx='9'
            cy='9'
            r={PROGRESS_RING_RADIUS}
            fill='none'
            strokeWidth='2.5'
            strokeLinecap='round'
            strokeDasharray={PROGRESS_RING_LENGTH}
            strokeDashoffset={PROGRESS_RING_LENGTH * (1 - ratio)}
            className={`stroke-brand-500 transition-[stroke-dashoffset] duration-500 ${ratio === 0 ? 'opacity-0' : ''}`}
          />
        </svg>
        {next ? `已看 ${completed}/${total}` : '已全部看过'}
      </span>
    </div>
  );
}

function ListActionButtons({
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
      {(list.visibility !== 'private' || isOwner) && (
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
      className={`${ICON_BUTTON_CLASS} ${BACK_BUTTON_CLASS}`}
    >
      <ArrowLeft className='h-5 w-5' />
    </button>
  );
}

// owner 为 null 时处于加载中，只有作者信息与操作按钮占位
function ListHeader({
  list,
  owner,
  showBack = true,
  actions,
}: {
  list: ListSummary;
  owner: PublicUserRef | null;
  showBack?: boolean;
  actions?: ReactNode;
}) {
  const description = list.description.trim();
  return (
    <header className={HEADER_CLASS}>
      <ListAmbient cover={list.covers[0]} />
      {showBack && <DesktopBackButton />}
      <div className={HEADER_BODY_CLASS}>
        <ListCover
          covers={list.covers}
          title={list.name}
          className={HEADER_COVER_CLASS}
        />
        <div className='min-w-0 flex-1'>
          <h1
            className={`${NAME_CLASS} break-words font-semibold text-gray-900 dark:text-gray-50`}
          >
            {list.name}
          </h1>
          {description && (
            <ExpandableText
              text={description}
              lines={3}
              className={`${DESCRIPTION_CLASS} max-w-2xl whitespace-pre-line text-gray-600 dark:text-gray-300`}
            />
          )}
          <div
            className={`${META_CLASS} flex flex-wrap items-center gap-x-4 gap-y-1.5 text-gray-500 dark:text-gray-400`}
          >
            {owner ? (
              <Link
                href={`/u/${encodeURIComponent(owner.profileId)}`}
                className='inline-flex items-center gap-1.5 font-medium text-gray-800 transition-colors hover:text-brand-600 dark:text-gray-200 dark:hover:text-brand-400'
              >
                <ProfileAvatar user={owner} className='h-5 w-5' />
                {owner.nickname ?? '未设置昵称'}
                <WatchLevelBadge level={owner.level} />
              </Link>
            ) : (
              <span
                aria-hidden='true'
                className='skeleton h-5 w-20 rounded-full'
              />
            )}
            <span className='inline-flex items-center gap-1 tabular-nums'>
              <ListVideo aria-hidden='true' className='h-3.5 w-3.5' />
              {list.itemCount} 部
            </span>
            <ListStats list={list} iconClassName='h-3.5 w-3.5' />
            <ListVisibilityBadge visibility={list.visibility} />
            <span className='inline-flex items-center gap-1'>
              <Clock aria-hidden='true' className='h-3.5 w-3.5' />
              更新于 {formatRelativeTime(list.updatedAt)}
            </span>
          </div>
          <div className={ACTIONS_CLASS}>{actions}</div>
        </div>
      </div>
    </header>
  );
}

// 取首张海报模糊成氛围光，与首页轮播的背景同一手法；桌面端向上铺进透明顶栏
function ListAmbient({ cover }: { cover: string | undefined }) {
  if (!cover) return null;
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute -left-16 -top-16 bottom-0 right-1/3 opacity-30 blur-3xl [mask-image:radial-gradient(closest-side,black_40%,transparent)] dark:opacity-40 md:-top-32'
    >
      <CoverImage src={cover} alt='' sizes='128px' fallbackLabel='' />
    </div>
  );
}

function ListItems({
  detail,
  guest,
  draft,
  busy,
  onDraftChange,
  onRemoveItem,
}: {
  detail: ListDetail;
  guest: boolean;
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
              guest={guest}
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

function ListDetailSkeleton({
  summary,
  itemCount,
  showBack,
}: {
  summary: ListSummary | null;
  itemCount: number | null;
  showBack: boolean;
}) {
  return (
    <div aria-hidden='true'>
      {summary ? (
        <ListHeader list={summary} owner={null} showBack={showBack} />
      ) : (
        <div className={HEADER_CLASS}>
          {showBack && <div className={`h-9 ${BACK_BUTTON_CLASS}`} />}
          <div className={HEADER_BODY_CLASS}>
            <div className={`skeleton ${HEADER_COVER_CLASS}`} />
            <div className='min-w-0 flex-1'>
              <SkeletonText
                className={NAME_CLASS}
                barClassName='h-7 w-48 rounded'
              />
              <SkeletonText
                className={META_CLASS}
                barClassName='h-4 w-56 rounded'
              />
              <div className={ACTIONS_CLASS} />
            </div>
          </div>
        </div>
      )}
      {itemCount === 0 ? (
        // 空片单多为作者本人查看，按带操作按钮的空状态占位
        <LibraryEmptySkeleton />
      ) : (
        itemCount !== null && <ListItemGridSkeleton count={itemCount} />
      )}
    </div>
  );
}
