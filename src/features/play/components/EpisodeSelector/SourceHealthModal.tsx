'use client';

import { X } from 'lucide-react';
import { useCallback, useId, useMemo } from 'react';

import ModalShell from '@/components/modals/ModalShell';
import type { SourceHealthSummary } from '@/features/play/lib/sourceHealthSummary';
import {
  type SourceHealthDailyStatus,
  type SourceHealthPublicItem,
  type SourceHealthPublicTier,
  isSmoothRateStuttering,
  SOURCE_HEALTH_TIER_PRIORITY,
} from '@/lib/source-quality-policy';

const TIER_LABEL: Record<SourceHealthPublicTier, string> = {
  good: '稳定',
  normal: '一般',
  poor: '不稳',
  offline: '失联',
};

const TIER_TEXT_CLASS: Record<SourceHealthPublicTier, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  normal: 'text-gray-600 dark:text-gray-300',
  poor: 'text-amber-600 dark:text-amber-400',
  offline: 'text-red-600 dark:text-red-400',
};

const CHIP_CLASS: Record<Exclude<SourceHealthPublicTier, 'normal'>, string> = {
  good: 'bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
  poor: 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  offline: 'bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-300',
};

const DAILY_CLASS: Record<SourceHealthDailyStatus, string> = {
  ok: 'bg-emerald-500 dark:bg-emerald-400',
  degraded: 'bg-amber-400 dark:bg-amber-400',
  down: 'bg-red-500 dark:bg-red-400',
  none: 'bg-gray-900/[0.08] dark:bg-white/[0.1]',
};

const DAILY_LABEL: Record<SourceHealthDailyStatus, string> = {
  ok: '正常',
  degraded: '波动',
  down: '异常',
  none: '无数据',
};

// 行内只显示一个徽标，优先提示失联、不稳与卡顿。
export function getSourceHealthChip(
  item: SourceHealthPublicItem | undefined,
): { label: string; className: string } | null {
  if (!item) return null;
  if (item.tier === 'offline' || item.tier === 'poor') {
    return { label: TIER_LABEL[item.tier], className: CHIP_CLASS[item.tier] };
  }
  if (isSmoothRateStuttering(item.smoothRate)) {
    return { label: '卡顿多', className: CHIP_CLASS.poor };
  }
  return item.tier === 'good'
    ? { label: TIER_LABEL.good, className: CHIP_CLASS.good }
    : null;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDay(date: string): string {
  const [, month, day] = date.split('-');
  return month && day ? `${Number(month)}月${Number(day)}日` : date;
}

function DailyStrip({ daily }: { daily: SourceHealthPublicItem['daily'] }) {
  return (
    <span className='flex shrink-0 items-center gap-[3px]'>
      {daily.map((point) => (
        <span
          key={point.date}
          title={`${formatDay(point.date)} · ${DAILY_LABEL[point.status]}`}
          className={`h-3.5 w-2 rounded-[2px] ${DAILY_CLASS[point.status]}`}
        />
      ))}
    </span>
  );
}

interface SourceHealthModalProps {
  isOpen: boolean;
  onClose: () => void;
  sources: readonly { key: string; name: string }[];
  summary: SourceHealthSummary;
  focusSource: string | null;
}

export function SourceHealthModal({
  isOpen,
  onClose,
  sources,
  summary,
  focusSource,
}: SourceHealthModalProps) {
  const titleId = useId();

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return sources
      .filter(({ key }) => !seen.has(key) && seen.add(key))
      .map((source, index) => ({
        ...source,
        index,
        item: summary[source.key] as SourceHealthPublicItem | undefined,
      }))
      .sort((a, b) => {
        if (!a.item || !b.item) return Number(!a.item) - Number(!b.item);
        return (
          SOURCE_HEALTH_TIER_PRIORITY[a.item.tier] -
            SOURCE_HEALTH_TIER_PRIORITY[b.item.tier] ||
          (b.item.playAvailability ?? -1) - (a.item.playAvailability ?? -1) ||
          a.index - b.index
        );
      });
  }, [sources, summary]);

  // 弹窗内容随 ModalShell 延后挂载，挂载时再滚到点击的源站
  const scrollToFocused = useCallback((node: HTMLLIElement | null) => {
    node?.scrollIntoView({ block: 'nearest' });
  }, []);

  const days = rows.find((row) => row.item)?.item?.daily ?? [];

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      panelClassName='flex max-h-[min(560px,85dvh)] max-w-md flex-col !rounded-xl border border-gray-200 dark:border-gray-700'
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        className='flex min-h-0 flex-1 flex-col'
      >
        <div className='flex flex-shrink-0 items-start justify-between gap-4 px-5 pb-3 pt-4'>
          <div className='min-w-0'>
            <h2
              id={titleId}
              className='text-base font-semibold text-gray-900 dark:text-gray-100'
            >
              源站近况
            </h2>
            <p className='mt-0.5 text-xs text-gray-500 dark:text-gray-400'>
              全站近 7 天参考，你的网络下以实际测速为准
            </p>
          </div>
          <button
            type='button'
            onClick={onClose}
            aria-label='关闭'
            className='-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08] dark:hover:text-gray-200'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        <div className='flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-5 pb-2.5 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400'>
          <span className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            {(['ok', 'degraded', 'down', 'none'] as const).map((status) => (
              <span key={status} className='inline-flex items-center gap-1'>
                <span
                  aria-hidden='true'
                  className={`h-2 w-2 rounded-[2px] ${DAILY_CLASS[status]}`}
                />
                {DAILY_LABEL[status]}
              </span>
            ))}
          </span>
          {days.length > 0 && (
            <span className='shrink-0 tabular-nums'>
              {formatDay(days[0].date)} – 今天
            </span>
          )}
        </div>

        <ul className='min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto px-5 dark:divide-white/[0.06]'>
          {rows.map(({ key, name, item }) => {
            const stats = item
              ? [
                  item.playAvailability !== null
                    ? `播放可用 ${formatPercent(item.playAvailability)}`
                    : '',
                  item.smoothRate !== null
                    ? `流畅 ${formatPercent(item.smoothRate)}`
                    : '',
                  item.searchAvailability !== null
                    ? `搜索可用 ${formatPercent(item.searchAvailability)}`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '';
            return (
              <li
                key={key}
                ref={key === focusSource ? scrollToFocused : undefined}
                className={`flex items-center gap-3 py-2.5 ${
                  key === focusSource
                    ? '-mx-2 rounded-lg bg-brand-500/[0.06] px-2 dark:bg-brand-400/[0.08]'
                    : ''
                }`}
              >
                <div className='min-w-0 flex-1'>
                  <div className='flex min-w-0 items-baseline gap-2'>
                    <span className='min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                      {name}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-medium ${
                        item
                          ? TIER_TEXT_CLASS[item.tier]
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {item ? TIER_LABEL[item.tier] : '样本不足'}
                      {item && isSmoothRateStuttering(item.smoothRate) && (
                        <span className={TIER_TEXT_CLASS.poor}>
                          {' · 卡顿多'}
                        </span>
                      )}
                    </span>
                  </div>
                  {item && (
                    <p className='mt-0.5 truncate text-[11px] tabular-nums text-gray-500 dark:text-gray-400'>
                      {item.tier === 'offline'
                        ? item.lastOkDate
                          ? `最近可用 ${formatDay(item.lastOkDate)}`
                          : '30 天内无可用记录'
                        : stats}
                    </p>
                  )}
                </div>
                {item && <DailyStrip daily={item.daily} />}
              </li>
            );
          })}
        </ul>
      </div>
    </ModalShell>
  );
}
