'use client';

import type Artplayer from 'artplayer';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from 'react';

import type { SkipConfigState } from '@/features/play/hooks/usePlayPageState';
import { formatTimeSimple } from '@/features/play/lib/formatTime';
import {
  deleteSkipConfig,
  getSkipConfig,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

interface UseSkipConfigOptions {
  currentSource: string;
  currentId: string;
  currentSourceRef: RefObject<string>;
  currentIdRef: RefObject<string>;
  skipConfigRef: RefObject<SkipConfigState>;
  artPlayerRef: RefObject<Artplayer | null>;
  setSkipConfig: Dispatch<SetStateAction<SkipConfigState>>;
}

type SaveState = {
  confirmed: SkipConfigState;
  revision: number;
  queue: Promise<void>;
};
type PendingMigration = {
  source: string;
  id: string;
  config: SkipConfigState;
  revision: number;
  resolve: (canDeletePrevious: boolean) => void;
};
const EMPTY_CONFIG: SkipConfigState = {
  enable: false,
  intro_time: 0,
  outro_time: 0,
};

export function useSkipConfig({
  currentSource,
  currentId,
  currentSourceRef,
  currentIdRef,
  skipConfigRef,
  artPlayerRef,
  setSkipConfig,
}: UseSkipConfigOptions) {
  const states = useRef(new Map<string, SaveState>());
  const pendingMigration = useRef<PendingMigration | null>(null);

  const registerSkipConfigMigration = useCallback(
    (source: string, id: string, config: SkipConfigState): Promise<boolean> => {
      pendingMigration.current?.resolve(false);
      pendingMigration.current = null;
      // 本地读到的空配置可能来自过期缓存，不据此删除服务端的旧源配置
      if (!config.enable && !config.intro_time && !config.outro_time)
        return Promise.resolve(false);
      return new Promise((resolve) => {
        pendingMigration.current = {
          source,
          id,
          config: { ...config },
          revision: states.current.get(`${source}+${id}`)?.revision ?? 0,
          resolve,
        };
      });
    },
    [],
  );

  const applyConfig = useCallback(
    (config: SkipConfigState) => {
      skipConfigRef.current = config;
      setSkipConfig(config);
      const setting = artPlayerRef.current?.setting;
      if (!setting) return;
      setting.update({
        name: '跳过片头片尾',
        html: '跳过片头片尾',
        switch: config.enable,
      });
      setting.update({
        name: '设置片头',
        html: '设置片头',
        tooltip:
          config.intro_time === 0
            ? '设置片头时间'
            : formatTimeSimple(config.intro_time),
      });
      setting.update({
        name: '设置片尾',
        html: '设置片尾',
        tooltip:
          config.outro_time >= 0
            ? '设置片尾时间'
            : `-${formatTimeSimple(-config.outro_time)}`,
      });
    },
    [artPlayerRef, setSkipConfig, skipConfigRef],
  );

  const enqueueConfig = useCallback(
    (
      source: string,
      id: string,
      newConfig: SkipConfigState,
      migration = false,
    ): Promise<boolean> => {
      const key = `${source}+${id}`;
      let state = states.current.get(key);
      if (!state) {
        state = {
          confirmed: { ...skipConfigRef.current },
          revision: 0,
          queue: Promise.resolve(),
        };
        states.current.set(key, state);
      }
      const saveState = state;
      const revision = ++saveState.revision;
      const config = { ...newConfig };
      applyConfig(config);
      const saved = saveState.queue.then(async () => {
        if (
          migration &&
          (saveState.revision !== revision ||
            currentSourceRef.current !== source ||
            currentIdRef.current !== id)
        )
          return false;
        try {
          if (!config.enable && !config.intro_time && !config.outro_time) {
            await deleteSkipConfig(source, id);
          } else {
            await saveSkipConfig(source, id, config);
          }
          saveState.confirmed = config;
          return true;
        } catch (error) {
          if (
            saveState.revision === revision &&
            currentSourceRef.current === source &&
            currentIdRef.current === id
          ) {
            applyConfig(saveState.confirmed);
          }
          if (!migration && !isAbortError(error))
            showToast(
              getErrorMessage(error, '跳过片头片尾设置未能保存，请重试'),
              'error',
            );
          return false;
        }
      });
      saveState.queue = saved.then(() => undefined);
      return saved;
    },
    [applyConfig, currentSourceRef, currentIdRef, skipConfigRef],
  );

  const handleSkipConfigChange = useCallback(
    async (config: SkipConfigState): Promise<void> => {
      const source = currentSourceRef.current;
      const id = currentIdRef.current;
      if (source && id) await enqueueConfig(source, id, config);
    },
    [currentSourceRef, currentIdRef, enqueueConfig],
  );

  useEffect(() => {
    if (!currentSource || !currentId) return;
    let active = true;
    const key = `${currentSource}+${currentId}`;
    const existing = states.current.get(key);
    const revision = existing?.revision ?? 0;
    const migration = pendingMigration.current;
    pendingMigration.current = null;
    const matchesMigration =
      migration?.source === currentSource && migration.id === currentId;
    if (migration && !matchesMigration) migration.resolve(false);
    void getSkipConfig(currentSource, currentId)
      .then((config) => {
        if (
          !active ||
          currentSourceRef.current !== currentSource ||
          currentIdRef.current !== currentId ||
          (states.current.get(key)?.revision ?? 0) !== revision ||
          (matchesMigration && migration.revision !== revision)
        ) {
          if (matchesMigration) migration.resolve(false);
          return;
        }
        const confirmed = config ?? EMPTY_CONFIG;
        if (!existing)
          states.current.set(key, {
            confirmed,
            revision: 0,
            queue: Promise.resolve(),
          });
        if (
          matchesMigration &&
          !config &&
          !existing?.revision &&
          migration.revision === revision
        ) {
          // 与用户设置共用队列，迁移完成只确认持久化，不回写较新的界面状态。
          void enqueueConfig(
            currentSource,
            currentId,
            migration.config,
            true,
          ).then(migration.resolve);
        } else {
          applyConfig(existing?.confirmed ?? confirmed);
          if (matchesMigration) migration.resolve(!!config);
        }
      })
      .catch((error) => {
        if (matchesMigration) migration.resolve(false);
        if (active && !isAbortError(error))
          showToast(
            getErrorMessage(error, '读取跳过片头片尾设置失败'),
            'error',
          );
      });
    // 读取先返回本地缓存，后台核对到服务端的新值（如其他设备修改）时再同步；本页已有修改或迁移时以本页为准
    const unsubscribe = subscribeToDataUpdates<Record<string, SkipConfigState>>(
      'skipConfigsUpdated',
      (configs) => {
        const state = states.current.get(key);
        if (!active || !state || state.revision !== revision) return;
        const next = configs[key] ?? EMPTY_CONFIG;
        if (
          next.enable === state.confirmed.enable &&
          next.intro_time === state.confirmed.intro_time &&
          next.outro_time === state.confirmed.outro_time
        )
          return;
        state.confirmed = { ...next };
        applyConfig(state.confirmed);
      },
    );
    return () => {
      active = false;
      unsubscribe();
      if (matchesMigration) migration.resolve(false);
    };
  }, [
    currentSource,
    currentId,
    currentSourceRef,
    currentIdRef,
    applyConfig,
    enqueueConfig,
  ]);

  return { handleSkipConfigChange, registerSkipConfigMigration };
}
