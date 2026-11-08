import {
  Bell,
  BellOff,
  BookmarkCheck,
  Check,
  ExternalLink,
  Heart,
  Play,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import Spinner from '@/components/Spinner';

export interface CardAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void | Promise<void>;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

// 宽高为 0 表示光标点，否则为触发按钮的矩形
export interface CardActionAnchor {
  top: number;
  left: number;
  width: number;
  height: number;
}

type Handler = CardAction['onClick'];

export interface CardActionSpec {
  play?: { onClick: Handler; live?: boolean };
  favorite?: { favorited: boolean | null; onToggle: Handler };
  watchRecord?: Handler | null;
  updates?: {
    hasUpdate: boolean;
    onMarkRead: Handler;
    tracking: boolean;
    onToggleTracking: Handler;
  };
  external?: { url: string; bangumi: boolean } | null;
  remove?: Handler;
}

export function buildCardActions(spec: CardActionSpec): CardAction[] {
  const actions: CardAction[] = [];
  if (spec.play) actions.push(playAction(spec.play));
  if (spec.favorite) {
    actions.push(
      favoriteAction(spec.favorite.favorited, spec.favorite.onToggle),
    );
  }
  if (spec.watchRecord) actions.push(watchRecordAction(spec.watchRecord));
  if (spec.updates) {
    if (spec.updates.hasUpdate) {
      actions.push(markUpdateReadAction(spec.updates.onMarkRead));
    }
    actions.push(
      trackingAction(spec.updates.tracking, spec.updates.onToggleTracking),
    );
  }
  if (spec.external) {
    actions.push(
      externalDetailAction(spec.external.url, spec.external.bangumi),
    );
  }
  if (spec.remove) actions.push(deleteRecordAction(spec.remove));
  return actions;
}

export function playAction(options: {
  onClick: Handler;
  live?: boolean;
}): CardAction {
  return {
    id: 'play',
    label: options.live ? '观看直播' : '立即播放',
    icon: <Play />,
    onClick: options.onClick,
  };
}

// favorited 为 null 时收藏状态仍在加载
export function favoriteAction(
  favorited: boolean | null,
  onClick: Handler,
): CardAction {
  if (favorited === null) {
    return {
      id: 'favorite',
      label: '加入收藏',
      icon: <Spinner className='h-4 w-4' />,
      disabled: true,
      onClick,
    };
  }

  return {
    id: 'favorite',
    label: favorited ? '取消收藏' : '加入收藏',
    icon: favorited ? (
      <Heart className='fill-current text-red-500 dark:text-red-400' />
    ) : (
      <Heart />
    ),
    onClick,
  };
}

export function watchRecordAction(onClick: Handler): CardAction {
  return {
    id: 'watch-record',
    label: '标记评分',
    icon: <BookmarkCheck />,
    onClick,
  };
}

export function trackingAction(enabled: boolean, onClick: Handler): CardAction {
  return {
    id: 'tracking',
    label: enabled ? '取消追更' : '开启追更',
    icon: enabled ? <BellOff /> : <Bell />,
    onClick,
  };
}

export function markUpdateReadAction(onClick: Handler): CardAction {
  return {
    id: 'mark-update-read',
    label: '标为已读',
    icon: <Check />,
    onClick,
  };
}

export function externalDetailAction(
  url: string,
  bangumi: boolean,
): CardAction {
  return {
    id: 'external-detail',
    label: bangumi ? 'Bangumi 详情' : '豆瓣详情',
    icon: <ExternalLink />,
    onClick: () => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}

export function deleteRecordAction(onClick: Handler): CardAction {
  return {
    id: 'delete',
    label: '删除记录',
    icon: <Trash2 />,
    tone: 'danger',
    onClick,
  };
}

function uniqueSourceNames(sources?: string[]) {
  return Array.from(new Set(sources ?? [])).filter(Boolean);
}

export function summarizeSources(sources?: string[]) {
  const names = uniqueSourceNames(sources);
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} 等 ${names.length} 个源`;
}
