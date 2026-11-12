'use client';

import { Gauge } from 'lucide-react';

import SkeletonText from '@/components/SkeletonText';
import {
  ADMIN_PANEL_CLASS,
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import {
  type HostTrafficStatus,
  formatTrafficBytes,
  TRAFFIC_PAUSE_RATIO,
  TRAFFIC_WARN_RATIO,
} from '@/lib/host-traffic';
import { formatRelativeTime } from '@/lib/relative-time';

const BODY_CLASS = 'px-4 py-4 sm:px-5';
const CAPTION_CLASS = 'text-xs text-gray-500 dark:text-gray-400';
const USED_CLASS = 'text-2xl font-semibold leading-8 tabular-nums';
const BAR_CLASS = 'relative mt-3 h-2 rounded-full';
const META_CLASS = 'mt-2 flex items-center justify-between gap-3 text-xs';
const STATS_CLASS =
  'grid grid-cols-2 divide-gray-200 border-t border-gray-200 dark:divide-white/[0.06] dark:border-white/[0.06] sm:grid-cols-4 sm:divide-x';
const STAT_CLASS = 'px-4 py-3 sm:px-5';
const STAT_VALUE_CLASS = 'mt-0.5 text-sm font-semibold tabular-nums';
const STAT_LABELS = ['今日', '预计本周期', '入站', '出站'] as const;

function formatCycleDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}

function usageTone(ratio: number | null) {
  if (ratio !== null && ratio >= TRAFFIC_PAUSE_RATIO) {
    return {
      fill: 'bg-red-500',
      text: 'text-red-600 dark:text-red-400',
    };
  }
  if (ratio !== null && ratio >= TRAFFIC_WARN_RATIO) {
    return {
      fill: 'bg-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    fill: 'bg-brand-500',
    text: 'text-gray-900 dark:text-gray-100',
  };
}

function ThresholdTick({ ratio, label }: { ratio: number; label: string }) {
  return (
    <span
      title={label}
      aria-hidden='true'
      className='absolute -top-0.5 h-3 w-px bg-gray-400/70 dark:bg-gray-500/70'
      style={{ left: `${ratio * 100}%` }}
    />
  );
}

export function TrafficUsageCard({ status }: { status: HostTrafficStatus }) {
  if (!status.available) {
    return (
      <div
        className={`${ADMIN_PANEL_CLASS} flex flex-col items-center gap-2 px-4 py-10 text-center`}
      >
        <Gauge className='h-6 w-6 text-gray-400 dark:text-gray-500' />
        <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
          未读取到流量统计
        </p>
        <p className={CAPTION_CLASS}>宿主机按部署文档配置 vnstat 后显示</p>
      </div>
    );
  }

  const ratio = status.usedRatio;
  const tone = usageTone(ratio);
  const projectedOver =
    status.quotaBytes > 0 &&
    status.projectedBytes !== null &&
    status.projectedBytes > status.quotaBytes;
  const stats = [
    formatTrafficBytes(status.todayBytes),
    status.projectedBytes === null
      ? '—'
      : formatTrafficBytes(status.projectedBytes),
    formatTrafficBytes(status.rxBytes),
    formatTrafficBytes(status.txBytes),
  ];

  return (
    <section aria-label='本周期流量' className={ADMIN_PANEL_CLASS}>
      <div className={BODY_CLASS}>
        <p className={CAPTION_CLASS}>本周期已用</p>
        <div className='mt-1 flex items-baseline justify-between gap-3'>
          <p className={`${USED_CLASS} ${tone.text}`}>
            {formatTrafficBytes(status.usedBytes)}
            {status.quotaBytes > 0 && (
              <span className='ml-1.5 text-sm font-normal text-gray-400 dark:text-gray-500'>
                / {formatTrafficBytes(status.quotaBytes)}
              </span>
            )}
          </p>
          {ratio !== null && (
            <span className={`text-sm font-medium tabular-nums ${tone.text}`}>
              {(ratio * 100).toFixed(1)}%
            </span>
          )}
        </div>
        {ratio !== null && (
          <div
            role='progressbar'
            aria-label='流量用量'
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(ratio, 1) * 100)}
            className={`${BAR_CLASS} bg-gray-100 dark:bg-white/[0.06]`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${tone.fill}`}
              style={{ width: `${Math.min(ratio, 1) * 100}%` }}
            />
            <ThresholdTick ratio={TRAFFIC_WARN_RATIO} label='80% 提醒' />
            <ThresholdTick
              ratio={TRAFFIC_PAUSE_RATIO}
              label='95% 自动暂停中转'
            />
          </div>
        )}
        <div className={META_CLASS}>
          <span className='text-gray-500 dark:text-gray-400'>
            {formatCycleDate(status.cycleEnd)}重置
          </span>
          {status.updatedAt !== null && (
            <span
              className={
                status.stale
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-500 dark:text-gray-400'
              }
            >
              {status.stale ? '统计已停止更新 · ' : '更新于 '}
              {formatRelativeTime(status.updatedAt)}
            </span>
          )}
        </div>
      </div>
      <dl className={STATS_CLASS}>
        {STAT_LABELS.map((label, index) => (
          <div key={label} className={STAT_CLASS}>
            <dt className={CAPTION_CLASS}>{label}</dt>
            <dd
              className={`${STAT_VALUE_CLASS} ${
                index === 1 && projectedOver
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-900 dark:text-gray-100'
              }`}
            >
              {stats[index]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function TrafficUsageCardSkeleton() {
  return (
    <div className={ADMIN_PANEL_CLASS}>
      <div className={BODY_CLASS}>
        <SkeletonText
          className={CAPTION_CLASS}
          barClassName='h-3 w-16 rounded'
        />
        <SkeletonText
          className={`mt-1 ${USED_CLASS}`}
          barClassName='h-6 w-40 rounded'
        />
        <div className={`${BAR_CLASS} skeleton`} />
        <div className={META_CLASS}>
          <SkeletonText barClassName='h-3 w-16 rounded' />
          <SkeletonText barClassName='h-3 w-24 rounded' />
        </div>
      </div>
      <div className={STATS_CLASS}>
        {STAT_LABELS.map((label) => (
          <div key={label} className={STAT_CLASS}>
            <p className={CAPTION_CLASS}>{label}</p>
            <SkeletonText
              className={STAT_VALUE_CLASS}
              barClassName='h-3.5 w-16 rounded'
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrafficTabSkeleton() {
  return (
    <div className='space-y-6'>
      <TrafficUsageCardSkeleton />
      <AdminSettingsGroup title='服务器中转'>
        <AdminSettingRow label='中转状态' />
      </AdminSettingsGroup>
      <AdminSettingsGroup
        title='额度'
        actions={<div className='skeleton h-8 w-[52px] rounded-lg' />}
      >
        {['月流量额度', '重置日'].map((label) => (
          <AdminSettingRow key={label} label={label}>
            <div className='skeleton h-9 w-40 rounded-lg' />
          </AdminSettingRow>
        ))}
      </AdminSettingsGroup>
    </div>
  );
}
