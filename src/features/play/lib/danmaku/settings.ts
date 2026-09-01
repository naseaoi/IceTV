import {
  getDanmakuPluginApi,
  isDanmakuFeatureEnabled,
  reloadDanmaku,
} from '@/features/play/lib/danmaku/attach';
import type { DanmakuLoadContext } from '@/features/play/lib/danmaku/resolve';
import {
  buildDanmakuScopeKey,
  DANMAKU_OFFSET_RANGE,
  readDanmakuEnabled,
  readDanmakuOffset,
  writeDanmakuEnabled,
  writeDanmakuOffset,
} from '@/lib/local-preferences';
import { showTimedArtNotice } from '@/lib/player-utils';

const OFFSET_STEP_SECONDS = 1;

// lucide MessageSquare
const DANMAKU_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

type PlayerLike = {
  plugins?: Record<string, unknown>;
  notice?: { show: string };
  constructor?: Function & { NOTICE_TIME?: number };
};

type SettingItem = {
  name?: string;
  html: string;
  icon?: string;
  tooltip?: string;
  switch?: boolean;
  onSwitch?: (item: { switch?: boolean }) => boolean;
  onClick?: () => string | void;
};

function formatOffset(offset: number): string {
  if (offset === 0) return '未偏移';
  return offset > 0 ? `延后 ${offset}s` : `提前 ${-offset}s`;
}

export function createDanmakuSettings(
  getPlayer: () => PlayerLike | null,
  context: DanmakuLoadContext,
): SettingItem[] {
  if (!isDanmakuFeatureEnabled()) return [];

  const scopeKey = buildDanmakuScopeKey(
    context.source,
    context.videoId,
    context.episodeIndex,
  );
  if (!scopeKey) return [];

  const shiftOffset = (delta: number) => {
    const next = readDanmakuOffset(scopeKey) + delta;
    if (next < DANMAKU_OFFSET_RANGE.min || next > DANMAKU_OFFSET_RANGE.max) {
      return formatOffset(readDanmakuOffset(scopeKey));
    }
    writeDanmakuOffset(scopeKey, next);
    const player = getPlayer();
    void reloadDanmaku(player, context);
    showTimedArtNotice(player, `弹幕${formatOffset(next)}`);
    return formatOffset(next);
  };

  return [
    {
      name: '弹幕',
      html: '弹幕',
      icon: DANMAKU_ICON,
      switch: readDanmakuEnabled(),
      onSwitch: function (item: { switch?: boolean }) {
        const next = !item.switch;
        writeDanmakuEnabled(next);
        const player = getPlayer();
        const api = getDanmakuPluginApi(player);
        if (api) {
          if (next) {
            api.show();
            // 关闭期间加载器返回空，开启后要真正拉一次
            void reloadDanmaku(player, context);
          } else {
            api.hide();
          }
        }
        return next;
      },
    },
    {
      name: '弹幕延后',
      html: '弹幕延后 1 秒',
      tooltip: formatOffset(readDanmakuOffset(scopeKey)),
      onClick: () => shiftOffset(OFFSET_STEP_SECONDS),
    },
    {
      name: '弹幕提前',
      html: '弹幕提前 1 秒',
      tooltip: formatOffset(readDanmakuOffset(scopeKey)),
      onClick: () => shiftOffset(-OFFSET_STEP_SECONDS),
    },
    {
      html: '重置弹幕偏移',
      onClick: () => {
        writeDanmakuOffset(scopeKey, 0);
        const player = getPlayer();
        void reloadDanmaku(player, context);
        showTimedArtNotice(player, '弹幕偏移已重置');
        return formatOffset(0);
      },
    },
  ];
}
