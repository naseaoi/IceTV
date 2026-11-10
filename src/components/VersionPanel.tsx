'use client';

import {
  ArrowUpRight,
  Bug,
  ChevronDown,
  ChevronUp,
  Download,
  Github,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell, { useDeferredClose } from '@/components/modals/ModalShell';
import { changelog, ChangelogEntry } from '@/lib/changelog';
import { getPrimaryRepoUrl } from '@/lib/update-source';
import { CURRENT_VERSION } from '@/lib/version';
import { compareVersions, UpdateStatus } from '@/lib/version-check';

interface VersionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TimelineEntry {
  entry: ChangelogEntry;
  type: 'current' | 'local' | 'remote' | 'update';
}

const VISIBLE_COUNT = 5;

type ChangeKind = 'added' | 'changed' | 'fixed' | 'admin';

const CHANGE_KINDS: Record<
  ChangeKind,
  { label: string; Icon: typeof Plus; labelClass: string; dotClass: string }
> = {
  added: {
    label: '新增',
    Icon: Plus,
    labelClass:
      'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400',
  },
  changed: {
    label: '改进',
    Icon: RefreshCw,
    labelClass:
      'bg-sky-500/10 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
    dotClass: 'bg-sky-500 dark:bg-sky-400',
  },
  fixed: {
    label: '修复',
    Icon: Bug,
    labelClass:
      'bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
  },
  admin: {
    label: '后台',
    Icon: ShieldCheck,
    labelClass:
      'bg-violet-500/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300',
    dotClass: 'bg-violet-500 dark:bg-violet-400',
  },
};

// 「主题：细节」写法的条目把主题加粗便于扫读；过长的前缀多半是正文里的冒号，不拆
const LEAD_PHRASE_RE = /^([^：:，。,]{2,12})[：:]\s*(.+)$/s;

function ChangeText({ text }: { text: string }) {
  const match = LEAD_PHRASE_RE.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      <span className='font-medium text-gray-900 dark:text-gray-100'>
        {match[1]}：
      </span>
      {match[2]}
    </>
  );
}

function hasPublicChanges(entry: ChangelogEntry) {
  return (
    entry.added.length > 0 || entry.changed.length > 0 || entry.fixed.length > 0
  );
}

export const VersionPanel: React.FC<VersionPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const [open, requestClose] = useDeferredClose(onClose);
  const [remoteChangelog, setRemoteChangelog] = useState<ChangelogEntry[]>([]);
  const [hasUpdate, setIsHasUpdate] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string>('');
  const [showAllEntries, setShowAllEntries] = useState(false);
  const repoUrl = getPrimaryRepoUrl();
  const { session } = useAuthSession();
  const showAdminChanges =
    session.status === 'authenticated' &&
    (session.role === 'owner' || session.role === 'admin');

  useEffect(() => {
    if (isOpen) {
      const controller = new AbortController();
      fetchRemoteChangelog(controller.signal);
      return () => controller.abort();
    }
    setShowAllEntries(false);
  }, [isOpen]);

  const fetchRemoteChangelog = async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/version/latest', {
        method: 'GET',
        cache: 'no-store',
        signal,
      });
      if (!response.ok) return;
      const data = await response.json();
      const parsed = Array.isArray(data?.changelog)
        ? (data.changelog as ChangelogEntry[])
        : [];
      setRemoteChangelog(parsed);
      const remoteVersion =
        typeof data?.latestVersion === 'string'
          ? data.latestVersion
          : parsed[0]?.version;
      if (remoteVersion) {
        setLatestVersion(remoteVersion);
        setIsHasUpdate(
          compareVersions(remoteVersion) === UpdateStatus.HAS_UPDATE,
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('获取远程变更日志失败:', error);
    }
  };

  // 构建统一时间线：远程新版本 + 本地版本，去重
  const timeline = useMemo<TimelineEntry[]>(() => {
    const localVersions = new Set(changelog.map((e) => e.version));

    // 远程独有的版本
    const remoteOnly = remoteChangelog
      .filter((e) => !localVersions.has(e.version))
      .map(
        (entry): TimelineEntry => ({
          entry,
          type: entry.version === latestVersion ? 'update' : 'remote',
        }),
      );

    // 如果有更新但远程日志里没有该版本详情，注入占位
    if (
      hasUpdate &&
      latestVersion &&
      !localVersions.has(latestVersion) &&
      !remoteOnly.some((e) => e.entry.version === latestVersion)
    ) {
      remoteOnly.unshift({
        entry: {
          version: latestVersion,
          date: '日期未知',
          added: [],
          changed: ['已检测到新版本，暂未获取到详细更新日志。'],
          fixed: [],
          admin: [],
        },
        type: 'update',
      });
    }

    // 本地版本
    const local = changelog.map(
      (entry): TimelineEntry => ({
        entry,
        type: entry.version === CURRENT_VERSION ? 'current' : 'local',
      }),
    );

    // 普通用户看不到后台条目，只含后台改动的历史版本整条隐藏
    return [...remoteOnly, ...local].filter(
      ({ entry, type }) =>
        showAdminChanges ||
        type === 'current' ||
        type === 'update' ||
        hasPublicChanges(entry),
    );
  }, [remoteChangelog, hasUpdate, latestVersion, showAdminChanges]);

  const visibleEntries = showAllEntries
    ? timeline
    : timeline.slice(0, VISIBLE_COUNT);
  const hasMore = timeline.length > VISIBLE_COUNT;

  const renderChanges = (items: string[], kind: ChangeKind) => {
    if (!items || items.length === 0) return null;
    const { label, Icon, labelClass, dotClass } = CHANGE_KINDS[kind];
    return (
      <div>
        <div
          className={`mb-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${labelClass}`}
        >
          <Icon className='h-3 w-3' />
          {label}
        </div>
        <ul className='space-y-2'>
          {items.map((item, i) => (
            <li
              key={i}
              className='flex gap-2.5 text-sm leading-6 text-gray-600 dark:text-gray-300'
            >
              <span
                aria-hidden='true'
                className={`mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
              />
              <span className='min-w-0'>
                <ChangeText text={item} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <ModalShell
      isOpen={isOpen && open}
      onClose={requestClose}
      panelClassName='flex max-h-[85vh] max-w-lg flex-col overflow-hidden'
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='version-panel-title'
        className='flex min-h-0 flex-1 flex-col'
      >
        <div className='flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-200/70 py-3 pl-5 pr-3 dark:border-white/[0.06]'>
          <div className='flex min-w-0 items-baseline gap-2'>
            <h3 id='version-panel-title' className={MODAL_TITLE_CLASS}>
              版本信息
            </h3>
            <span className='font-mono text-xs text-gray-400 dark:text-gray-500'>
              v{CURRENT_VERSION}
            </span>
          </div>
          <div className='flex items-center gap-1'>
            {repoUrl && (
              <a
                href={repoUrl}
                target='_blank'
                rel='noopener noreferrer'
                className={MODAL_CLOSE_BUTTON_CLASS}
                aria-label='打开项目 GitHub'
              >
                <Github className='h-4 w-4' />
              </a>
            )}
            <button
              type='button'
              onClick={requestClose}
              className={MODAL_CLOSE_BUTTON_CLASS}
              aria-label='关闭'
            >
              <X className='h-4 w-4' />
            </button>
          </div>
        </div>

        <div className='flex-1 overflow-y-auto px-5 pb-5 pt-4'>
          {hasUpdate && (
            <div className='mb-5 flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-4 py-3 dark:bg-brand-500/10'>
              <div className='flex min-w-0 items-center gap-2.5'>
                <Download className='h-4 w-4 flex-shrink-0 text-brand-600 dark:text-brand-300' />
                <p className='truncate text-sm text-gray-900 dark:text-gray-100'>
                  v{latestVersion} 可用
                </p>
              </div>
              {repoUrl && (
                <a
                  href={repoUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-full bg-brand-600 px-3.5 text-xs font-medium text-white transition-colors hover:bg-brand-500'
                >
                  前往更新
                  <ArrowUpRight className='h-3 w-3' />
                </a>
              )}
            </div>
          )}

          <ol className='relative'>
            {visibleEntries.map(({ entry, type }, index) => {
              const isCurrent = type === 'current';
              const isUpdate = type === 'update';
              const isRemote = type === 'remote' || type === 'update';
              const isLast = index === visibleEntries.length - 1;

              return (
                <li
                  key={entry.version}
                  className='relative pb-6 pl-6 last:pb-0'
                >
                  {!isLast && (
                    <span className='absolute bottom-0 left-[4px] top-3 w-px bg-gray-200 dark:bg-white/[0.08]' />
                  )}
                  <span
                    className={`absolute left-0 top-[7px] h-[9px] w-[9px] rounded-full ring-4 ring-white dark:ring-gray-900 ${
                      isCurrent || isUpdate
                        ? 'bg-brand-500'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  />
                  <div className='mb-2 flex items-baseline justify-between gap-3'>
                    <div className='flex items-baseline gap-2'>
                      <span className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                        v{entry.version}
                      </span>
                      {isCurrent && (
                        <span className='text-xs text-brand-600 dark:text-brand-300'>
                          当前
                        </span>
                      )}
                      {isUpdate && (
                        <span className='text-xs text-brand-600 dark:text-brand-300'>
                          新版本
                        </span>
                      )}
                      {isRemote && !isUpdate && (
                        <span className='text-xs text-gray-400 dark:text-gray-500'>
                          远程
                        </span>
                      )}
                    </div>
                    <span className='shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500'>
                      {entry.date}
                    </span>
                  </div>

                  <div className='space-y-4'>
                    {renderChanges(entry.added, 'added')}
                    {renderChanges(entry.changed, 'changed')}
                    {renderChanges(entry.fixed, 'fixed')}
                    {showAdminChanges && renderChanges(entry.admin, 'admin')}
                  </div>
                </li>
              );
            })}
          </ol>

          {hasMore && (
            <button
              type='button'
              onClick={() => setShowAllEntries((prev) => !prev)}
              className='mt-4 flex w-full items-center justify-center gap-1.5 rounded-full py-2 text-xs text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
            >
              {showAllEntries ? (
                <>
                  <ChevronUp className='h-3.5 w-3.5' />
                  收起
                </>
              ) : (
                <>
                  <ChevronDown className='h-3.5 w-3.5' />
                  查看全部 {timeline.length} 个版本
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
};
