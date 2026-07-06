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
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

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

export const VersionPanel: React.FC<VersionPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const [mounted, setMounted] = useState(false);
  const [remoteChangelog, setRemoteChangelog] = useState<ChangelogEntry[]>([]);
  const [hasUpdate, setIsHasUpdate] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string>('');
  const [showAllEntries, setShowAllEntries] = useState(false);
  const repoUrl = getPrimaryRepoUrl();

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Body 滚动锁定
  useEffect(() => {
    if (isOpen) {
      const body = document.body;
      const html = document.documentElement;
      const originalBodyOverflow = body.style.overflow;
      const originalHtmlOverflow = html.style.overflow;
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';
      return () => {
        body.style.overflow = originalBodyOverflow;
        html.style.overflow = originalHtmlOverflow;
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const controller = new AbortController();
      fetchRemoteChangelog(controller.signal);
      return () => controller.abort();
    } else {
      setShowAllEntries(false);
    }
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

    return [...remoteOnly, ...local];
  }, [remoteChangelog, hasUpdate, latestVersion]);

  const visibleEntries = showAllEntries
    ? timeline
    : timeline.slice(0, VISIBLE_COUNT);
  const hasMore = timeline.length > VISIBLE_COUNT;

  // 变更分类渲染
  const renderChanges = (
    items: string[],
    icon: React.ReactNode,
    label: string,
    dotColor: string,
  ) => {
    if (!items || items.length === 0) return null;
    return (
      <div>
        <div className='mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400'>
          {icon}
          {label}
        </div>
        <ul className='space-y-1'>
          {items.map((item, i) => (
            <li
              key={i}
              className='flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300'
            >
              <span
                className={`mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotColor}`}
              />
              {item}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  if (!mounted || !isOpen) return null;

  return createPortal(
    <>
      {/* 遮罩 */}
      <div
        className='fixed inset-0 z-[1000] bg-black/50 backdrop-blur-sm'
        onClick={onClose}
        onTouchMove={(e) => e.preventDefault()}
        onWheel={(e) => e.preventDefault()}
        style={{ touchAction: 'none' }}
      />

      {/* 面板 */}
      <div
        className='fixed left-1/2 top-1/2 z-[1001] flex max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10'
        onTouchMove={(e) => e.stopPropagation()}
        style={{ touchAction: 'auto' }}
      >
        {/* 标题栏 */}
        <div className='flex flex-shrink-0 items-center justify-between border-b border-gray-200/80 px-5 py-4 dark:border-gray-700/80'>
          <div className='flex items-center gap-3'>
            <div className='flex items-center gap-1.5'>
              <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                版本信息
              </h3>
              <a
                href={repoUrl}
                target='_blank'
                rel='noopener noreferrer'
                className='flex h-6 w-6 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200'
                aria-label='打开项目 GitHub'
              >
                <Github className='h-4 w-4' />
              </a>
            </div>
            <span className='rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400'>
              v{CURRENT_VERSION}
            </span>
          </div>
          <button
            onClick={onClose}
            className='flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300'
            aria-label='关闭'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        {/* 可滚动内容 */}
        <div className='flex-1 overflow-y-auto'>
          <div className='space-y-4 p-5'>
            {/* 更新提示卡片 — 仅有更新时显示 */}
            {hasUpdate && (
              <div className='flex items-center justify-between gap-3 rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 dark:border-amber-700/50 dark:bg-amber-900/20'>
                <div className='flex min-w-0 items-center gap-3'>
                  <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-800/40'>
                    <Download className='h-4 w-4 text-amber-600 dark:text-amber-400' />
                  </div>
                  <div className='min-w-0'>
                    <p className='text-sm font-medium text-amber-800 dark:text-amber-200'>
                      v{latestVersion} 可用
                    </p>
                    <p className='text-xs text-amber-600 dark:text-amber-400'>
                      当前 v{CURRENT_VERSION}
                    </p>
                  </div>
                </div>
                {repoUrl && (
                  <a
                    href={repoUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='flex flex-shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600'
                  >
                    前往更新
                    <ArrowUpRight className='h-3 w-3' />
                  </a>
                )}
              </div>
            )}

            {/* 时间线变更日志 */}
            <div className='space-y-3'>
              {visibleEntries.map(({ entry, type }) => {
                const isCurrent = type === 'current';
                const isUpdate = type === 'update';
                const isRemote = type === 'remote' || type === 'update';

                return (
                  <div
                    key={entry.version}
                    className={`rounded-xl border p-4 transition-colors ${
                      isCurrent
                        ? 'border-blue-200/80 bg-blue-50/60 dark:border-blue-800/50 dark:bg-blue-900/15'
                        : isUpdate
                          ? 'border-amber-200/80 bg-amber-50/40 dark:border-amber-800/50 dark:bg-amber-900/10'
                          : 'border-gray-200/80 bg-gray-50/50 dark:border-gray-700/60 dark:bg-gray-800/40'
                    }`}
                  >
                    {/* 版本头 */}
                    <div className='mb-3 flex items-center justify-between'>
                      <div className='flex items-center gap-2'>
                        <span className='text-sm font-semibold text-gray-800 dark:text-gray-200'>
                          v{entry.version}
                        </span>
                        {isCurrent && (
                          <span className='rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'>
                            当前
                          </span>
                        )}
                        {isUpdate && (
                          <span className='rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'>
                            新版本
                          </span>
                        )}
                        {isRemote && !isUpdate && (
                          <span className='rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400'>
                            远程
                          </span>
                        )}
                      </div>
                      <span className='text-xs text-gray-400 dark:text-gray-500'>
                        {entry.date}
                      </span>
                    </div>

                    {/* 变更内容 */}
                    <div className='space-y-2.5'>
                      {renderChanges(
                        entry.added,
                        <Plus className='h-3 w-3' />,
                        '新增',
                        'bg-emerald-500',
                      )}
                      {renderChanges(
                        entry.changed,
                        <RefreshCw className='h-3 w-3' />,
                        '改进',
                        'bg-blue-500',
                      )}
                      {renderChanges(
                        entry.fixed,
                        <Bug className='h-3 w-3' />,
                        '修复',
                        'bg-purple-500',
                      )}
                    </div>
                  </div>
                );
              })}

              {/* 查看更多 */}
              {hasMore && (
                <button
                  onClick={() => setShowAllEntries((prev) => !prev)}
                  className='flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-800/60 dark:hover:text-gray-400'
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
        </div>
      </div>
    </>,
    document.body,
  );
};
