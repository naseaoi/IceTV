import { useEffect, useRef, useState } from 'react';

import {
  type LiveChannelGroup,
  liveGroupFavoriteId,
} from '@/features/live/lib/liveChannelGroups';
import type { LiveSource } from '@/features/live/types';
import {
  deleteFavorite,
  generateStorageKey,
  getAllFavorites,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';

export function useLiveFavorite({
  currentSource,
  groups,
}: {
  currentSource: LiveSource | null;
  groups: LiveChannelGroup[];
}) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const pending = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    let revision = 0;
    const sync = (favorites: Record<string, unknown>) => {
      if (active) {
        setKeys(new Set(Object.keys(favorites)));
        setReady(true);
      }
    };
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, unknown>) => {
        revision++;
        sync(favorites);
      },
    );
    const initialRevision = revision;
    void getAllFavorites()
      .then((favorites) => {
        if (revision === initialRevision) sync(favorites);
      })
      .catch(() => {
        if (active) showToast('收藏状态加载失败，请刷新重试', 'error');
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const idsFor = (group: LiveChannelGroup) => [
    liveGroupFavoriteId(group.groupKey),
    ...group.lines.map((line) => `live_${line.id}`),
  ];
  const isGroupFavorited = (group: LiveChannelGroup) =>
    Boolean(
      currentSource &&
      idsFor(group).some((id) =>
        keys.has(generateStorageKey(`live_${currentSource.key}`, id)),
      ),
    );
  const toggleGroupFavorite = async (group: LiveChannelGroup) => {
    if (!currentSource || !ready) return;
    const source = `live_${currentSource.key}`;
    const id = liveGroupFavoriteId(group.groupKey);
    const key = generateStorageKey(source, id);
    if (pending.current.has(key)) return;
    pending.current.add(key);
    try {
      if (isGroupFavorited(group)) {
        // 每次成功的删除由收藏事件同步；部分失败保持尚未删除的旧键可见。
        for (const existing of idsFor(group)) {
          const existingKey = generateStorageKey(source, existing);
          if (!keys.has(existingKey)) continue;
          await deleteFavorite(source, existing);
          setKeys((prev) => {
            const next = new Set(prev);
            next.delete(existingKey);
            return next;
          });
        }
      } else {
        await saveFavorite(source, id, {
          title: group.name,
          source_name: currentSource.name,
          year: '',
          cover: `/api/proxy/logo?url=${encodeURIComponent(group.logo)}&icetv-source=${encodeURIComponent(currentSource.key)}`,
          total_episodes: 1,
          save_time: Date.now(),
          search_title: '',
          origin: 'live',
        });
        setKeys((prev) => new Set([...prev, key]));
      }
    } catch {
      showToast('收藏操作失败，请重试', 'error');
    } finally {
      pending.current.delete(key);
    }
  };
  return {
    ready,
    isGroupFavorited,
    toggleGroupFavorite,
    favoriteGroups: groups.filter(isGroupFavorited),
  };
}
