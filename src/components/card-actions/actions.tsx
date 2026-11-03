import {
  Bell,
  BellOff,
  Check,
  ExternalLink,
  Heart,
  Play,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import Spinner from '@/components/Spinner';

// 相邻两项分组不同时画分隔线
export type CardActionGroup = 'play' | 'manage' | 'link' | 'danger';

export interface CardAction {
  id: string;
  label: string;
  icon: ReactNode;
  group: CardActionGroup;
  onClick: () => void | Promise<void>;
  tone?: 'default' | 'danger';
  meta?: string;
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

export function getEpisodeMeta(
  currentEpisode?: number,
  totalEpisodes?: number,
) {
  return currentEpisode && totalEpisodes && totalEpisodes > 1
    ? `第 ${currentEpisode} 集`
    : undefined;
}

export function playAction(options: {
  onClick: Handler;
  live?: boolean;
  meta?: string;
}): CardAction {
  return {
    id: 'play',
    label: options.live ? '观看直播' : '播放',
    icon: <Play />,
    group: 'play',
    meta: options.meta,
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
      label: '收藏',
      icon: <Spinner className='h-4 w-4' />,
      group: 'manage',
      disabled: true,
      onClick,
    };
  }

  return {
    id: 'favorite',
    label: favorited ? '取消收藏' : '收藏',
    icon: favorited ? (
      <Heart className='fill-current text-red-500 dark:text-red-400' />
    ) : (
      <Heart />
    ),
    group: 'manage',
    onClick,
  };
}

export function trackingAction(enabled: boolean, onClick: Handler): CardAction {
  return {
    id: 'tracking',
    label: enabled ? '取消追更' : '追更',
    icon: enabled ? <BellOff /> : <Bell />,
    group: 'manage',
    onClick,
  };
}

export function markUpdateReadAction(onClick: Handler): CardAction {
  return {
    id: 'mark-update-read',
    label: '标记更新已读',
    icon: <Check />,
    group: 'manage',
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
    group: 'link',
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
    group: 'danger',
    tone: 'danger',
    onClick,
  };
}

export function summarizeSources(sources?: string[]) {
  const names = Array.from(new Set(sources ?? [])).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} 等 ${names.length} 个源`;
}
