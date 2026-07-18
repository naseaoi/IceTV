import type Artplayer from 'artplayer';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import { writeBlockAdEnabled } from '@/lib/local-preferences';
import {
  destroyManagedHls,
  runManagedVideoCleanup,
} from '@/lib/player-runtime';
import { OPEN_PLAYER_SHORTCUTS_EVENT } from '@/lib/player-shortcuts';
import { formatTime } from '@/lib/player-utils';
import type { SkipConfig } from '@/lib/types';

type ArtPlayerSettingsOptions = {
  artPlayerRef: MutableRefObject<Artplayer | null>;
  blockAdEnabled: boolean;
  skipConfigRef: MutableRefObject<SkipConfig>;
  resumeTimeRef: MutableRefObject<number | null>;
  resumeModeRef: MutableRefObject<ResumeMode>;
  setBlockAdEnabled: Dispatch<SetStateAction<boolean>>;
  handleSkipConfigChange: (newConfig: SkipConfig) => Promise<void>;
};

type ArtPlayerControlsOptions = {
  handleNextEpisode: () => void;
};

export function createArtPlayerSettings({
  artPlayerRef,
  blockAdEnabled,
  skipConfigRef,
  resumeTimeRef,
  resumeModeRef,
  setBlockAdEnabled,
  handleSkipConfigChange,
}: ArtPlayerSettingsOptions) {
  return [
    {
      html: '去广告',
      icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
      tooltip: blockAdEnabled ? '已开启' : '已关闭',
      onClick() {
        const newVal = !blockAdEnabled;
        try {
          writeBlockAdEnabled(newVal);
          if (artPlayerRef.current) {
            resumeTimeRef.current = artPlayerRef.current.currentTime;
            resumeModeRef.current = 'forced';
            const managedVideo = artPlayerRef.current.video;
            runManagedVideoCleanup(managedVideo);
            destroyManagedHls(managedVideo);
            artPlayerRef.current.destroy();
            artPlayerRef.current = null;
          }
          setBlockAdEnabled(newVal);
        } catch {
          return blockAdEnabled ? '当前开启' : '当前关闭';
        }
        return newVal ? '当前开启' : '当前关闭';
      },
    },
    {
      name: '跳过片头片尾',
      html: '跳过片头片尾',
      switch: skipConfigRef.current.enable,
      onSwitch: function (item: { switch?: boolean }) {
        const newConfig = {
          ...skipConfigRef.current,
          enable: !item.switch,
        };
        handleSkipConfigChange(newConfig);
        return !item.switch;
      },
    },
    {
      html: '删除跳过配置',
      onClick: function () {
        handleSkipConfigChange({
          enable: false,
          intro_time: 0,
          outro_time: 0,
        });
        return '';
      },
    },
    {
      name: '设置片头',
      html: '设置片头',
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
      tooltip:
        skipConfigRef.current.intro_time === 0
          ? '设置片头时间'
          : `${formatTime(skipConfigRef.current.intro_time)}`,
      onClick: function () {
        const currentTime = artPlayerRef.current?.currentTime || 0;
        if (currentTime > 0) {
          const newConfig = {
            ...skipConfigRef.current,
            intro_time: currentTime,
          };
          handleSkipConfigChange(newConfig);
          return `${formatTime(currentTime)}`;
        }
      },
    },
    {
      name: '设置片尾',
      html: '设置片尾',
      icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
      tooltip:
        skipConfigRef.current.outro_time >= 0
          ? '设置片尾时间'
          : `-${formatTime(-skipConfigRef.current.outro_time)}`,
      onClick: function () {
        const outroTime =
          -(
            (artPlayerRef.current?.duration ?? 0) -
            (artPlayerRef.current?.currentTime ?? 0)
          ) || 0;
        if (outroTime < 0) {
          const newConfig = {
            ...skipConfigRef.current,
            outro_time: outroTime,
          };
          handleSkipConfigChange(newConfig);
          return `-${formatTime(-outroTime)}`;
        }
      },
    },
  ];
}

export function createArtPlayerControls({
  handleNextEpisode,
}: ArtPlayerControlsOptions) {
  return [
    {
      position: 'left',
      index: 13,
      html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
      tooltip: '播放下一集',
      click: function () {
        handleNextEpisode();
      },
    },
  ];
}

export function createArtPlayerContextmenus() {
  return [
    {
      html: '快捷键配置',
      click(this: Artplayer) {
        this.contextmenu.show = false;
        window.dispatchEvent(new CustomEvent(OPEN_PLAYER_SHORTCUTS_EVENT));
      },
    },
  ];
}
