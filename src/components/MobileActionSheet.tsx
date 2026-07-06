import { Radio, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import CoverImage from '@/components/CoverImage';

export interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: (e?: React.MouseEvent) => void | Promise<void>;
  color?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
}

export interface ActionSheetAnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface MobileActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  actions: ActionItem[];
  poster?: string;
  sources?: string[]; // 播放源信息
  isAggregate?: boolean; // 是否为聚合内容
  sourceName?: string; // 播放源名称
  currentEpisode?: number; // 当前集数
  totalEpisodes?: number; // 总集数
  origin?: 'vod' | 'live';
  anchorRect?: ActionSheetAnchorRect | null;
}

const MobileActionSheet: React.FC<MobileActionSheetProps> = ({
  isOpen,
  onClose,
  title,
  actions,
  poster,
  sources,
  isAggregate,
  sourceName,
  currentEpisode,
  totalEpisodes,
  origin = 'vod',
  anchorRect = null,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [activeMode, setActiveMode] = useState<'mobile' | 'desktop'>('mobile');
  const [desktopAnchorRect, setDesktopAnchorRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isDesktopContextMenu = useMemo(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return Boolean(anchorRect) && window.matchMedia('(pointer: fine)').matches;
  }, [anchorRect]);
  const [desktopPosition, setDesktopPosition] = useState({ top: 12, left: 12 });

  const getInitialDesktopPosition = (rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  }) => {
    if (typeof window === 'undefined') {
      return {
        top: Math.max(8, rect.top),
        left: Math.max(8, rect.left + rect.width + 10),
      };
    }

    const viewportPadding = 8;
    const sideGap = 10;
    const estimatedPanelWidth = Math.min(256, window.innerWidth - 16);
    const preferredRightLeft = rect.left + rect.width + sideGap;
    const fallbackLeft = rect.left - estimatedPanelWidth - sideGap;

    const left =
      preferredRightLeft + estimatedPanelWidth >
      window.innerWidth - viewportPadding
        ? fallbackLeft
        : preferredRightLeft;

    return {
      top: Math.max(viewportPadding, rect.top),
      left: Math.max(
        viewportPadding,
        Math.min(
          left,
          window.innerWidth - estimatedPanelWidth - viewportPadding,
        ),
      ),
    };
  };

  // 控制动画状态
  useEffect(() => {
    let animationId: number;
    let timer: NodeJS.Timeout;

    if (isOpen) {
      const desktopMode = isDesktopContextMenu && !!anchorRect;
      setActiveMode(desktopMode ? 'desktop' : 'mobile');
      if (desktopMode && anchorRect) {
        setDesktopAnchorRect(anchorRect);
        setDesktopPosition(getInitialDesktopPosition(anchorRect));
      }

      setIsVisible(true);
      // 使用双重 requestAnimationFrame 确保DOM完全渲染
      animationId = requestAnimationFrame(() => {
        animationId = requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      setIsAnimating(false);
      // 等待动画完成后隐藏组件
      timer = setTimeout(() => {
        setIsVisible(false);
      }, 200);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [anchorRect, isDesktopContextMenu, isOpen]);

  useEffect(() => {
    if (
      isOpen &&
      isVisible &&
      activeMode === 'desktop' &&
      isDesktopContextMenu &&
      anchorRect
    ) {
      setDesktopAnchorRect(anchorRect);
      setDesktopPosition(getInitialDesktopPosition(anchorRect));
    }
  }, [activeMode, anchorRect, isDesktopContextMenu, isOpen, isVisible]);

  // 阻止背景滚动
  useEffect(() => {
    if (!isOpen) {
      return;
    }
  }, [isOpen, poster]);

  useEffect(() => {
    if (
      !isVisible ||
      activeMode !== 'desktop' ||
      !desktopAnchorRect ||
      !panelRef.current
    ) {
      return;
    }

    const updatePosition = () => {
      if (!panelRef.current) return;

      const panelHeight = panelRef.current.offsetHeight;
      const panelWidth = panelRef.current.offsetWidth;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const viewportPadding = 8;
      const sideGap = 10;

      const preferredRightLeft =
        desktopAnchorRect.left + desktopAnchorRect.width + sideGap;
      const fallbackLeft = desktopAnchorRect.left - panelWidth - sideGap;

      let left = preferredRightLeft;
      if (preferredRightLeft + panelWidth > viewportWidth - viewportPadding) {
        left = fallbackLeft;
      }
      left = Math.max(
        viewportPadding,
        Math.min(left, viewportWidth - panelWidth - viewportPadding),
      );

      let top =
        desktopAnchorRect.top + desktopAnchorRect.height / 2 - panelHeight / 2;
      top = Math.max(
        viewportPadding,
        Math.min(top, viewportHeight - panelHeight - viewportPadding),
      );

      setDesktopPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [activeMode, desktopAnchorRect, isVisible, actions.length]);

  useEffect(() => {
    if (!isVisible || activeMode !== 'desktop') {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!panelRef.current) {
        return;
      }
      if (!panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (!panelRef.current) {
        return;
      }
      if (!panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
    };
  }, [activeMode, isVisible, onClose]);

  useEffect(() => {
    if (!isVisible || activeMode !== 'desktop') {
      return;
    }

    const isEventFromPanel = (event: Event) => {
      if (!panelRef.current) {
        return false;
      }
      return panelRef.current.contains(event.target as Node);
    };

    const handleScrollClose = (event: Event) => {
      if (isEventFromPanel(event)) {
        return;
      }
      onClose();
    };

    window.addEventListener('scroll', handleScrollClose, true);
    window.addEventListener('wheel', handleScrollClose, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener('scroll', handleScrollClose, true);
      window.removeEventListener('wheel', handleScrollClose, true);
    };
  }, [activeMode, isVisible, onClose]);

  const posterPreview = (
    <div className='relative h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200/60 bg-gray-100 dark:border-gray-700/60 dark:bg-gray-800'>
      <CoverImage
        src={poster || ''}
        alt={title}
        fit={origin === 'live' ? 'contain' : 'cover'}
        sizes='48px'
      />
    </div>
  );

  const getActionColor = (color: ActionItem['color']) => {
    switch (color) {
      case 'danger':
        return 'text-red-600 dark:text-red-400';
      case 'primary':
        return 'text-green-600 dark:text-green-400';
      default:
        return 'text-gray-700 dark:text-gray-300';
    }
  };

  const getActionHoverColor = (
    color: ActionItem['color'],
    compact?: boolean,
  ) => {
    if (compact) {
      switch (color) {
        case 'danger':
          return 'hover:bg-rose-50/70 dark:hover:bg-rose-500/10';
        case 'primary':
          return 'hover:bg-gray-100/70 dark:hover:bg-white/[0.06]';
        default:
          return 'hover:bg-gray-100/70 dark:hover:bg-white/[0.06]';
      }
    }
    switch (color) {
      case 'danger':
        return 'hover:bg-red-50/50 dark:hover:bg-red-900/10';
      case 'primary':
        return 'hover:bg-green-50/50 dark:hover:bg-green-900/10';
      default:
        return 'hover:bg-gray-50/50 dark:hover:bg-gray-800/20';
    }
  };

  const getActionColorCompact = (color: ActionItem['color']) => {
    switch (color) {
      case 'danger':
        return 'text-rose-600 dark:text-rose-300';
      case 'primary':
        return 'text-gray-700 dark:text-gray-200';
      default:
        return 'text-gray-700 dark:text-gray-200';
    }
  };

  const renderActionList = (compact?: boolean) => (
    <div className={compact ? 'py-2' : 'px-4 py-2'}>
      {actions.map((action, index) => (
        <div key={action.id}>
          <button
            onClick={() => {
              action.onClick();
              onClose();
            }}
            disabled={action.disabled}
            className={
              compact
                ? `flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    action.disabled
                      ? 'cursor-not-allowed opacity-50'
                      : getActionHoverColor(action.color, true)
                  }`
                : `flex w-full items-center gap-4 px-2 py-4 transition-all duration-150 ease-out ${
                    action.disabled
                      ? 'cursor-not-allowed opacity-50'
                      : `${getActionHoverColor(action.color)} active:scale-[0.98]`
                  }`
            }
            style={
              compact
                ? undefined
                : { willChange: 'transform, background-color' }
            }
          >
            <div
              className={`flex flex-shrink-0 items-center justify-center ${compact ? 'h-4 w-4' : 'h-6 w-6'}`}
            >
              <span
                className={`transition-colors duration-150 ${
                  action.disabled
                    ? 'text-gray-400 dark:text-gray-600'
                    : compact
                      ? getActionColorCompact(action.color)
                      : getActionColor(action.color)
                }`}
              >
                {action.icon}
              </span>
            </div>

            <span
              className={
                compact
                  ? `flex-1 text-left text-sm font-medium ${
                      action.disabled
                        ? 'text-gray-400 dark:text-gray-600'
                        : action.color === 'danger'
                          ? 'text-rose-600 dark:text-rose-300'
                          : 'text-gray-700 dark:text-gray-200'
                    }`
                  : `flex-1 text-left text-base font-medium ${
                      action.disabled
                        ? 'text-gray-400 dark:text-gray-600'
                        : 'text-gray-900 dark:text-gray-100'
                    }`
              }
            >
              {action.label}
            </span>

            {action.id === 'play' && currentEpisode && totalEpisodes && (
              <span className='text-sm font-medium text-gray-500 dark:text-gray-400'>
                {currentEpisode}/{totalEpisodes}
              </span>
            )}
          </button>

          {index < actions.length - 1 &&
            (compact ? (
              <div className='mx-4 my-0.5 h-px bg-gradient-to-r from-transparent via-gray-200/80 to-transparent dark:via-white/[0.10]' />
            ) : (
              <div className='ml-10 border-b border-gray-100 dark:border-gray-800' />
            ))}
        </div>
      ))}
    </div>
  );

  const actionList = renderActionList(false);

  const renderSourceInfo = (compact?: boolean) =>
    isAggregate && sources && sources.length > 0 ? (
      <div
        className={
          compact
            ? 'px-4 py-3'
            : 'border-t border-gray-100 px-4 py-3 dark:border-gray-800'
        }
      >
        {compact && (
          <div className='-mt-1 mb-3 h-px bg-gradient-to-r from-transparent via-gray-200/80 to-transparent dark:via-white/[0.10]' />
        )}
        <div className='mb-3'>
          <h4 className='mb-1 text-sm font-medium text-gray-900 dark:text-gray-100'>
            可用播放源
          </h4>
          <p className='text-xs text-gray-500 dark:text-gray-400'>
            共 {sources.length} 个播放源
          </p>
        </div>

        <div className='max-h-32 overflow-y-auto'>
          <div className='grid grid-cols-2 gap-2'>
            {sources.map((source, index) => (
              <div
                key={index}
                className='flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/30 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/30'
              >
                <div className='h-1 w-1 flex-shrink-0 rounded-full bg-gray-400 dark:bg-gray-500' />
                <span className='truncate text-xs text-gray-600 dark:text-gray-400'>
                  {source}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    ) : null;

  const sourceInfo = renderSourceInfo(false);

  useEffect(() => {
    if (isVisible) {
      if (activeMode === 'desktop') {
        return;
      }
      // 保存当前滚动位置
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      const body = document.body;
      const html = document.documentElement;

      // 获取滚动条宽度
      const scrollBarWidth = window.innerWidth - html.clientWidth;

      // 保存原始样式
      const originalBodyStyle = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        paddingRight: body.style.paddingRight,
        overflow: body.style.overflow,
      };

      // 设置body样式来阻止滚动，但保持原位置
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = `-${scrollX}px`;
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      body.style.paddingRight = `${scrollBarWidth}px`;

      return () => {
        // 恢复所有原始样式
        body.style.position = originalBodyStyle.position;
        body.style.top = originalBodyStyle.top;
        body.style.left = originalBodyStyle.left;
        body.style.right = originalBodyStyle.right;
        body.style.width = originalBodyStyle.width;
        body.style.paddingRight = originalBodyStyle.paddingRight;
        body.style.overflow = originalBodyStyle.overflow;

        // 使用 requestAnimationFrame 确保样式恢复后再滚动
        requestAnimationFrame(() => {
          window.scrollTo(scrollX, scrollY);
        });
      };
    }
  }, [activeMode, isVisible]);

  // ESC键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  if (activeMode === 'desktop' && desktopAnchorRect) {
    return (
      <div className='pointer-events-none fixed inset-0 z-[9999]'>
        <div
          ref={panelRef}
          className={`pointer-events-auto absolute w-64 max-w-[calc(100vw-16px)] origin-top select-none rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl transition-[opacity,transform] duration-150 ease-out dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10 ${
            isAnimating
              ? 'translate-y-0 scale-100 opacity-100'
              : 'translate-y-1 scale-95 opacity-0'
          }`}
          style={{
            top: `${desktopPosition.top}px`,
            left: `${desktopPosition.left}px`,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          {/* 顶部信息 */}
          <div className='px-4 pb-2 pt-3'>
            <div className='flex items-start justify-between gap-3'>
              <div className='flex min-w-0 flex-1 items-center gap-3'>
                {posterPreview}
                <div className='min-w-0 flex-1'>
                  <div className='mb-0.5 flex min-w-0 items-center gap-2'>
                    <h3 className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      {title}
                    </h3>
                  </div>
                  <div className='flex items-center gap-2'>
                    {sourceName && (
                      <span className='inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-900/30 dark:text-green-200'>
                        {origin === 'live' && (
                          <Radio
                            size={10}
                            className='mr-1 inline-block text-green-600 dark:text-green-300'
                          />
                        )}
                        {sourceName}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={onClose}
                className='rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100/70 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'
                aria-label='关闭菜单'
              >
                <X size={18} className='h-5 w-5' />
              </button>
            </div>
          </div>

          <div className='mx-4 h-px bg-gradient-to-r from-transparent via-gray-200/80 to-transparent dark:via-white/[0.10]' />

          {renderActionList(true)}
          {renderSourceInfo(true)}
        </div>
      </div>
    );
  }

  return (
    <div
      className='fixed inset-0 z-[9999] flex items-end justify-center'
      onTouchMove={(e) => {
        // 阻止最外层容器的触摸移动，防止背景滚动
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        touchAction: 'none', // 禁用所有触摸操作
      }}
    >
      {/* 背景遮罩 */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out ${
          isAnimating ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        onTouchMove={(e) => {
          // 只阻止滚动，允许其他触摸事件（包括点击）
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滚轮滚动
          e.preventDefault();
        }}
        style={{
          backdropFilter: 'blur(4px)',
          willChange: 'opacity',
          touchAction: 'none', // 禁用所有触摸操作
        }}
      />

      {/* 操作表单 */}
      <div
        className='relative mx-4 mb-4 w-full max-w-lg rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl transition-all duration-200 ease-out dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10'
        onTouchMove={(e) => {
          // 允许操作表单内部滚动，阻止事件冒泡到外层
          e.stopPropagation();
        }}
        style={{
          marginBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          willChange: 'transform, opacity',
          backfaceVisibility: 'hidden', // 避免闪烁
          transform: isAnimating
            ? 'translateY(0) translateZ(0)'
            : 'translateY(100%) translateZ(0)', // 组合变换保持滑入效果和硬件加速
          opacity: isAnimating ? 1 : 0,
          touchAction: 'auto', // 允许操作表单内的正常触摸操作
        }}
      >
        {/* 头部 */}
        <div className='flex items-center justify-between border-b border-gray-100 p-4 dark:border-gray-800'>
          <div className='flex min-w-0 flex-1 items-center gap-3'>
            {posterPreview}
            <div className='min-w-0 flex-1'>
              <div className='mb-1 flex items-center gap-2'>
                <h3 className='truncate text-lg font-semibold text-gray-900 dark:text-gray-100'>
                  {title}
                </h3>
                {sourceName && (
                  <span className='flex-shrink-0 rounded border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400'>
                    {origin === 'live' && (
                      <Radio
                        size={12}
                        className='mr-1.5 inline-block text-gray-500 dark:text-gray-400'
                      />
                    )}
                    {sourceName}
                  </span>
                )}
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                选择操作
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className='rounded-full p-2 transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800'
          >
            <X size={20} className='text-gray-500 dark:text-gray-400' />
          </button>
        </div>

        {/* 操作列表 */}
        {actionList}

        {/* 播放源信息展示区域 */}
        {sourceInfo}
      </div>
    </div>
  );
};

export default MobileActionSheet;
