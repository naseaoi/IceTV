import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type CardAction,
  type CardActionAnchor,
  summarizeSources,
} from '@/components/card-actions/actions';
import CardActionMenu from '@/components/card-actions/CardActionMenu';
import CardActionSheet from '@/components/card-actions/CardActionSheet';

const CLOSE_ANIMATION_MS = 200;

export interface CardActionContent {
  title: string;
  actions: CardAction[];
  poster?: string;
  // 聚合卡片的全部来源名
  sources?: string[];
  sourceName?: string;
  origin?: 'vod' | 'live';
  // 有锚点且为精确指针时显示为桌面菜单，否则为底部面板
  anchorRect?: CardActionAnchor | null;
}

interface CardActionOverlayProps extends CardActionContent {
  isOpen: boolean;
  onClose: () => void;
}

export default function CardActionOverlay({
  isOpen,
  onClose,
  ...content
}: CardActionOverlayProps) {
  // 关闭动画期间沿用打开时的内容，调用方此时已清空 payload
  const contentRef = useRef<CardActionContent>(content);
  if (isOpen) {
    contentRef.current = content;
  }
  const visible = contentRef.current;
  const hasAnchor = Boolean(visible.anchorRect);

  const [mode, setMode] = useState<'menu' | 'sheet' | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(
        hasAnchor && window.matchMedia('(pointer: fine)').matches
          ? 'menu'
          : 'sheet',
      );
      // 双帧确保初始态先绘制，入场过渡才会生效
      let frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setShown(true));
      });
      return () => window.cancelAnimationFrame(frame);
    }

    setShown(false);
    const timer = window.setTimeout(() => setMode(null), CLOSE_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [hasAnchor, isOpen]);

  const handleAction = useCallback(
    (action: CardAction) => {
      void action.onClick();
      onClose();
    },
    [onClose],
  );

  if (!mode) return null;

  const sourcesSummary = summarizeSources(visible.sources);

  if (mode === 'menu' && visible.anchorRect) {
    const anchor = visible.anchorRect;
    return (
      <CardActionMenu
        key={`${anchor.top}:${anchor.left}`}
        shown={shown}
        anchor={anchor}
        title={visible.title}
        footer={sourcesSummary}
        actions={visible.actions}
        onAction={handleAction}
        onClose={onClose}
      />
    );
  }

  return (
    <CardActionSheet
      shown={shown}
      title={visible.title}
      subtitle={sourcesSummary || visible.sourceName}
      poster={visible.poster}
      live={visible.origin === 'live'}
      actions={visible.actions}
      onAction={handleAction}
      onClose={onClose}
    />
  );
}
