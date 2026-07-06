'use client';

import type Artplayer from 'artplayer';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
} from 'react';

import type { SkipConfigState } from '@/features/play/hooks/usePlayPageState';
import { formatTimeSimple } from '@/features/play/lib/formatTime';
import {
  deleteSkipConfig,
  getSkipConfig,
  saveSkipConfig,
} from '@/lib/db.client';

interface UseSkipConfigOptions {
  currentSource: string;
  currentId: string;
  currentSourceRef: RefObject<string>;
  currentIdRef: RefObject<string>;
  skipConfigRef: RefObject<SkipConfigState>;
  artPlayerRef: RefObject<Artplayer | null>;
  setSkipConfig: Dispatch<SetStateAction<SkipConfigState>>;
}

export function useSkipConfig({
  currentSource,
  currentId,
  currentSourceRef,
  currentIdRef,
  skipConfigRef,
  artPlayerRef,
  setSkipConfig,
}: UseSkipConfigOptions) {
  const handleSkipConfigChange = useCallback(
    async (newConfig: SkipConfigState) => {
      if (!currentSourceRef.current || !currentIdRef.current) return;

      try {
        setSkipConfig(newConfig);
        if (
          !newConfig.enable &&
          !newConfig.intro_time &&
          !newConfig.outro_time
        ) {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current,
          );
          const updateSetting = artPlayerRef.current?.setting.update.bind(
            artPlayerRef.current.setting,
          );
          if (updateSetting) {
            updateSetting({
              name: '跳过片头片尾',
              html: '跳过片头片尾',
              switch: skipConfigRef.current.enable,
              onSwitch(item: { switch?: boolean }) {
                const cfg = { ...skipConfigRef.current, enable: !item.switch };
                handleSkipConfigChange(cfg);
                return !item.switch;
              },
            } as Parameters<typeof updateSetting>[0]);
            updateSetting({
              name: '设置片头',
              html: '设置片头',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
              tooltip:
                skipConfigRef.current.intro_time === 0
                  ? '设置片头时间'
                  : `${formatTimeSimple(skipConfigRef.current.intro_time)}`,
              onClick: function () {
                const currentTime = artPlayerRef.current?.currentTime || 0;
                if (currentTime > 0) {
                  const cfg = {
                    ...skipConfigRef.current,
                    intro_time: currentTime,
                  };
                  handleSkipConfigChange(cfg);
                  return `${formatTimeSimple(currentTime)}`;
                }
              },
            } as Parameters<typeof updateSetting>[0]);
            updateSetting({
              name: '设置片尾',
              html: '设置片尾',
              icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
              tooltip:
                skipConfigRef.current.outro_time >= 0
                  ? '设置片尾时间'
                  : `-${formatTimeSimple(-skipConfigRef.current.outro_time)}`,
              onClick: function () {
                const outroTime =
                  -(
                    (artPlayerRef.current?.duration ?? 0) -
                    (artPlayerRef.current?.currentTime ?? 0)
                  ) || 0;
                if (outroTime < 0) {
                  const cfg = {
                    ...skipConfigRef.current,
                    outro_time: outroTime,
                  };
                  handleSkipConfigChange(cfg);
                  return `-${formatTimeSimple(-outroTime)}`;
                }
              },
            } as Parameters<typeof updateSetting>[0]);
          }
        } else {
          await saveSkipConfig(
            currentSourceRef.current,
            currentIdRef.current,
            newConfig,
          );
        }
      } catch (err) {
        console.error('保存跳过片头片尾配置失败:', err);
      }
    },
    [
      artPlayerRef,
      currentSourceRef,
      currentIdRef,
      setSkipConfig,
      skipConfigRef,
    ],
  );

  // 进入新视频时读取已存档的跳过配置
  useEffect(() => {
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;
      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) setSkipConfig(config);
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };
    initSkipConfig();
  }, []);

  return { handleSkipConfigChange };
}
