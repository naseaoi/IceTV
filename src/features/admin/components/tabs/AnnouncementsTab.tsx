'use client';

import { Send } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import AlertModal from '@/components/modals/AlertModal';
import ConfirmModal from '@/components/modals/ConfirmModal';
import MoreMenu, { type MoreMenuItem } from '@/components/MoreMenu';
import Spinner from '@/components/Spinner';
import { AdminAnnouncementRowsSkeleton } from '@/features/admin/components/AdminContentSkeleton';
import { AdminSettingsGroup } from '@/features/admin/components/AdminSettings';
import {
  ANNOUNCEMENT_ACTION_CLASS,
  ANNOUNCEMENT_COMPOSER_CLASS,
  ANNOUNCEMENT_COMPOSER_ROWS,
  ANNOUNCEMENT_EMPTY_CLASS,
  ANNOUNCEMENT_META_CLASS,
  ANNOUNCEMENT_ROW_CLASS,
  ANNOUNCEMENT_TEXT_CLASS,
} from '@/features/admin/lib/announcement-layout';
import {
  adminDelete,
  adminGet,
  adminPatch,
  adminPost,
} from '@/features/admin/lib/api';
import { buttonStyles } from '@/features/admin/lib/buttonStyles';
import { showError } from '@/features/admin/lib/notifications';
import { useAlertModal } from '@/hooks/useAlertModal';
import { ANNOUNCEMENT_MAX_LENGTH } from '@/lib/announcement-identity';
import { formatRelativeTime } from '@/lib/relative-time';
import type { SiteAnnouncement } from '@/lib/types';
import type { AdminConfig } from '@/types/admin';

const ENDPOINT = '/api/admin/announcements';
const COMPOSER_DISABLED_CLASS =
  'disabled:cursor-not-allowed disabled:opacity-50';
const STATUS_BADGE_CLASS = 'rounded px-1.5 font-medium';
const DEFAULT_SKELETON_ROWS = 4;

type PendingConfirm =
  | { kind: 'push-new' }
  | { kind: 'push'; item: SiteAnnouncement }
  | { kind: 'delete'; item: SiteAnnouncement };

// 草稿在前，已推送按推送时间倒序，与服务端列表顺序一致
function sortAnnouncements(items: SiteAnnouncement[]): SiteAnnouncement[] {
  return [...items].sort((a, b) => {
    if ((a.publishedAt === null) !== (b.publishedAt === null))
      return a.publishedAt === null ? -1 : 1;
    const timeA = a.publishedAt ?? a.createdAt;
    const timeB = b.publishedAt ?? b.createdAt;
    return timeB - timeA || (a.id < b.id ? 1 : -1);
  });
}

export default function AnnouncementsTab({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) {
  const [items, setItems] = useState<SiteAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const content = draft.trim();

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await adminGet<{ items: SiteAnnouncement[] }>(
        ENDPOINT,
        '加载公告失败',
      );
      setItems(data.items ?? []);
    } catch (error) {
      setFailed(true);
      showError(
        error instanceof Error ? error.message : '加载公告失败',
        showAlert,
      );
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const upsert = (announcement: SiteAnnouncement) =>
    setItems((previous) =>
      sortAnnouncements([
        announcement,
        ...previous.filter((item) => item.id !== announcement.id),
      ]),
    );

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showError(error instanceof Error ? error.message : fallback, showAlert);
    } finally {
      setBusy(false);
    }
  };

  const resetComposer = () => {
    setDraft('');
    setEditingId(null);
  };

  // 条数变化后刷新后台配置，下次进入本页时骨架按新条数占位
  const create = (publish: boolean) =>
    run(async () => {
      const { announcement } = await adminPost<{
        announcement: SiteAnnouncement;
      }>(ENDPOINT, { content, publish }, '保存公告失败');
      upsert(announcement);
      resetComposer();
      void refreshConfig();
    }, '保存公告失败');

  const saveEdit = () =>
    run(async () => {
      if (!editingId) return;
      const { announcement } = await adminPatch<{
        announcement: SiteAnnouncement;
      }>(ENDPOINT, { id: editingId, content }, '保存公告失败');
      upsert(announcement);
      resetComposer();
    }, '保存公告失败');

  const changeStatus = (
    item: SiteAnnouncement,
    action: 'publish' | 'withdraw',
  ) =>
    run(async () => {
      const { announcement } = await adminPatch<{
        announcement: SiteAnnouncement;
      }>(
        ENDPOINT,
        { id: item.id, action },
        action === 'publish' ? '推送公告失败' : '撤回公告失败',
      );
      upsert(announcement);
    }, '更新公告失败');

  const remove = (item: SiteAnnouncement) =>
    run(async () => {
      await adminDelete(ENDPOINT, { id: item.id }, '删除公告失败');
      setItems((previous) => previous.filter(({ id }) => id !== item.id));
      if (editingId === item.id) resetComposer();
      void refreshConfig();
    }, '删除公告失败');

  const startEdit = (item: SiteAnnouncement) => {
    setEditingId(item.id);
    setDraft(item.content);
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ block: 'nearest' });
  };

  const confirmPending = async () => {
    const current = pending;
    setPending(null);
    if (!current) return;
    if (current.kind === 'push-new') await create(true);
    else if (current.kind === 'push')
      await changeStatus(current.item, 'publish');
    else await remove(current.item);
  };

  const menuItems = (item: SiteAnnouncement): MoreMenuItem[] => [
    { label: '编辑', onSelect: () => startEdit(item), disabled: busy },
    ...(item.publishedAt !== null
      ? [
          {
            label: '撤回',
            onSelect: () => void changeStatus(item, 'withdraw'),
            disabled: busy,
          },
        ]
      : []),
    {
      label: '删除',
      onSelect: () => setPending({ kind: 'delete', item }),
      danger: true,
      disabled: busy,
    },
  ];

  return (
    <div className='space-y-8'>
      <AdminSettingsGroup
        title={editingId ? '编辑公告' : '发布公告'}
        actions={
          editingId ? (
            <>
              <button
                type='button'
                disabled={busy}
                onClick={resetComposer}
                className={buttonStyles.secondary}
              >
                取消
              </button>
              <button
                type='button'
                disabled={busy || !content}
                onClick={() => void saveEdit()}
                className={`${buttonStyles.primary} ${COMPOSER_DISABLED_CLASS}`}
              >
                保存修改
              </button>
            </>
          ) : (
            <>
              <button
                type='button'
                disabled={busy || !content}
                onClick={() => void create(false)}
                className={`${buttonStyles.outline} ${COMPOSER_DISABLED_CLASS}`}
              >
                存为草稿
              </button>
              <button
                type='button'
                disabled={busy || !content}
                onClick={() => setPending({ kind: 'push-new' })}
                className={`${buttonStyles.primary} ${COMPOSER_DISABLED_CLASS} inline-flex items-center gap-1.5`}
              >
                {busy ? (
                  <Spinner className='h-3.5 w-3.5' />
                ) : (
                  <Send aria-hidden='true' className='h-3.5 w-3.5' />
                )}
                推送
              </button>
            </>
          )
        }
      >
        <textarea
          ref={composerRef}
          aria-label={editingId ? '编辑公告' : '新公告'}
          placeholder='写一条新公告'
          value={draft}
          maxLength={ANNOUNCEMENT_MAX_LENGTH}
          rows={ANNOUNCEMENT_COMPOSER_ROWS}
          onChange={(event) => setDraft(event.target.value)}
          className={ANNOUNCEMENT_COMPOSER_CLASS}
        />
      </AdminSettingsGroup>

      <AdminSettingsGroup title='公告列表'>
        <div aria-busy={loading}>
          {items.length > 0 && (
            <ul
              aria-label='公告列表'
              className='divide-y divide-gray-200 dark:divide-white/[0.06]'
            >
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`${ANNOUNCEMENT_ROW_CLASS} ${
                    editingId === item.id
                      ? 'bg-brand-50/60 first:rounded-t-xl last:rounded-b-xl dark:bg-brand-950/20'
                      : ''
                  }`}
                >
                  <div className='min-w-0 flex-1'>
                    <p
                      className={`${ANNOUNCEMENT_TEXT_CLASS} whitespace-pre-line break-words text-gray-900 dark:text-gray-100`}
                    >
                      {item.content}
                    </p>
                    <p
                      className={`${ANNOUNCEMENT_META_CLASS} flex items-center gap-2 text-gray-500 dark:text-gray-400`}
                    >
                      {item.publishedAt !== null ? (
                        <>
                          <span
                            className={`${STATUS_BADGE_CLASS} bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300`}
                          >
                            已推送
                          </span>
                          <time
                            dateTime={new Date(item.publishedAt).toISOString()}
                          >
                            {formatRelativeTime(item.publishedAt)}
                          </time>
                        </>
                      ) : (
                        <>
                          <span
                            className={`${STATUS_BADGE_CLASS} bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300`}
                          >
                            草稿
                          </span>
                          <time
                            dateTime={new Date(item.updatedAt).toISOString()}
                          >
                            {formatRelativeTime(item.updatedAt)}
                          </time>
                        </>
                      )}
                    </p>
                  </div>
                  <div
                    className={`${ANNOUNCEMENT_ACTION_CLASS} flex shrink-0 items-center gap-1`}
                  >
                    {item.publishedAt === null && (
                      <button
                        type='button'
                        disabled={busy}
                        onClick={() => setPending({ kind: 'push', item })}
                        className={`${buttonStyles.roundedPrimary} gap-1`}
                      >
                        <Send aria-hidden='true' className='h-3 w-3' />
                        推送
                      </button>
                    )}
                    <MoreMenu label='公告操作' items={menuItems(item)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {loading && items.length === 0 && (
            <AdminAnnouncementRowsSkeleton
              count={
                config?.SiteConfig.AnnouncementCount ?? DEFAULT_SKELETON_ROWS
              }
            />
          )}
          {!loading && !failed && items.length === 0 && (
            <p
              className={`${ANNOUNCEMENT_EMPTY_CLASS} text-sm text-gray-500 dark:text-gray-400`}
            >
              还没有公告
            </p>
          )}
          {!loading && failed && (
            <div className='flex justify-center p-4'>
              <button
                type='button'
                onClick={() => void load()}
                className={buttonStyles.secondary}
              >
                重新加载
              </button>
            </div>
          )}
        </div>
      </AdminSettingsGroup>

      <ConfirmModal
        isOpen={pending !== null}
        title={pending?.kind === 'delete' ? '删除公告' : '推送公告'}
        message={
          pending?.kind === 'delete'
            ? pending.item.publishedAt !== null
              ? '删除后用户的公告历史中也不再显示这条公告。'
              : '确认删除这条草稿？'
            : '推送后所有用户都会收到这条公告提醒。'
        }
        confirmText={pending?.kind === 'delete' ? '确认删除' : '确认推送'}
        danger={pending?.kind === 'delete'}
        confirmDisabled={busy}
        onClose={() => setPending(null)}
        onConfirm={() => void confirmPending()}
      />
      <AlertModal {...alertModal} onClose={hideAlert} />
    </div>
  );
}
