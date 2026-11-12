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

  const handleSkipConfigChange = useCallback(
    (newConfig: SkipConfigState): Promise<void> => {
      const source = currentSourceRef.current;
      const id = currentIdRef.current;
      if (!source || !id) return Promise.resolve();
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
      saveState.queue = saveState.queue.then(async () => {
        try {
          if (!config.enable && !config.intro_time && !config.outro_time) {
            await deleteSkipConfig(source, id);
          } else {
            await saveSkipConfig(source, id, config);
          }
          saveState.confirmed = config;
        } catch (error) {
          if (
            saveState.revision === revision &&
            currentSourceRef.current === source &&
            currentIdRef.current === id
          ) {
            applyConfig(saveState.confirmed);
          }
          if (!isAbortError(error))
            showToast(
              getErrorMessage(error, '跳过片头片尾设置未能保存，请重试'),
              'error',
            );
        }
      });
      return saveState.queue;
    },
    [applyConfig, currentSourceRef, currentIdRef, skipConfigRef],
  );

  useEffect(() => {
    if (!currentSource || !currentId) return;
    let active = true;
    const key = `${currentSource}+${currentId}`;
    const existing = states.current.get(key);
    const revision = existing?.revision ?? 0;
    void getSkipConfig(currentSource, currentId)
      .then((config) => {
        if (!active || (states.current.get(key)?.revision ?? 0) !== revision)
          return;
        const confirmed = config ?? EMPTY_CONFIG;
        if (!existing)
          states.current.set(key, {
            confirmed,
            revision: 0,
            queue: Promise.resolve(),
          });
        applyConfig(existing?.confirmed ?? confirmed);
      })
      .catch((error) => {
        if (active && !isAbortError(error))
          showToast(
            getErrorMessage(error, '读取跳过片头片尾设置失败'),
            'error',
          );
      });
    return () => {
      active = false;
    };
  }, [currentSource, currentId, applyConfig]);

  return { handleSkipConfigChange };
}
