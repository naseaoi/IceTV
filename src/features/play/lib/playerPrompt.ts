import type Artplayer from 'artplayer';

export interface PlayerPromptAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface PlayerPrompt {
  readonly visible: boolean;
  show: (
    text: string,
    actions: PlayerPromptAction[],
    durationMs?: number,
  ) => void;
  setText: (text: string) => void;
  hide: () => void;
}

type PromptHost = Pick<Artplayer, 'template' | 'on'>;

/**
 * 播放器内带操作按钮的提示卡片（Artplayer notice 只能显示纯文本）。
 * 挂在 $player 下、位于控制栏之上，控制栏显示时自动上移避让。
 */
export function createPlayerPrompt(
  art: PromptHost,
  placement: 'start' | 'end',
): PlayerPrompt {
  const host = art.template.$player;
  let element: HTMLDivElement | null = null;
  let textNode: HTMLSpanElement | null = null;
  let hideTimer: number | null = null;

  const clearHideTimer = () => {
    if (hideTimer === null) return;
    window.clearTimeout(hideTimer);
    hideTimer = null;
  };

  const hide = () => {
    clearHideTimer();
    element?.remove();
    element = null;
    textNode = null;
  };

  art.on('destroy', hide);

  return {
    get visible() {
      return element !== null;
    },
    show(text, actions, durationMs) {
      if (!host) return;
      hide();
      const card = document.createElement('div');
      card.className = `ice-player-prompt ice-player-prompt-${placement}`;
      const label = document.createElement('span');
      label.className = 'ice-player-prompt-text';
      label.textContent = text;
      card.appendChild(label);
      for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = action.primary
          ? 'ice-player-prompt-action ice-player-prompt-action-primary'
          : 'ice-player-prompt-action';
        button.textContent = action.label;
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          action.onClick();
        });
        card.appendChild(button);
      }
      host.appendChild(card);
      element = card;
      textNode = label;
      if (durationMs && durationMs > 0)
        hideTimer = window.setTimeout(hide, durationMs);
    },
    setText(text) {
      if (textNode && textNode.textContent !== text)
        textNode.textContent = text;
    },
    hide,
  };
}
