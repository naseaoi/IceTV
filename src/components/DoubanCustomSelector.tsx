'use client';

import React, { useCallback, useEffect, useRef } from 'react';

import {
  CapsuleSelector,
  useCapsuleIndicator,
  useSyncIndicator,
} from './CapsuleSelector';

interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

interface DoubanCustomSelectorProps {
  customCategories: CustomCategory[];
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}

const DoubanCustomSelector: React.FC<DoubanCustomSelectorProps> = ({
  customCategories,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
}) => {
  const primary = useCapsuleIndicator();
  const secondary = useCapsuleIndicator();

  // 二级选择器滚动容器的ref
  const secondaryScrollContainerRef = useRef<HTMLDivElement>(null);

  // 根据 customCategories 生成一级选择器选项（按 type 分组，电影优先）
  const primaryOptions = React.useMemo(() => {
    const types = Array.from(new Set(customCategories.map((cat) => cat.type)));
    const sortedTypes = types.sort((a, b) => {
      if (a === 'movie' && b !== 'movie') return -1;
      if (a !== 'movie' && b === 'movie') return 1;
      return 0;
    });
    return sortedTypes.map((type) => ({
      label: type === 'movie' ? '电影' : '剧集',
      value: type,
    }));
  }, [customCategories]);

  // 根据选中的一级选项生成二级选择器选项
  const secondaryOptions = React.useMemo(() => {
    if (!primarySelection) return [];
    return customCategories
      .filter((cat) => cat.type === primarySelection)
      .map((cat) => ({
        label: cat.name || cat.query,
        value: cat.query,
      }));
  }, [customCategories, primarySelection]);

  // 同步指示器位置
  useSyncIndicator(
    primaryOptions,
    primarySelection,
    primaryOptions[0]?.value ?? '',
    primary.updatePosition,
  );
  useSyncIndicator(
    secondaryOptions,
    secondarySelection,
    secondaryOptions[0]?.value ?? '',
    secondary.updatePosition,
  );

  // 处理二级选择器的鼠标滚轮事件（原生 DOM 事件）
  const handleSecondaryWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = secondaryScrollContainerRef.current;
    if (container) {
      container.scrollLeft += e.deltaY * 2;
    }
  }, []);

  // 添加二级选择器的鼠标滚轮事件监听器
  useEffect(() => {
    const scrollContainer = secondaryScrollContainerRef.current;
    const capsuleContainer = secondary.containerRef.current;

    if (scrollContainer && capsuleContainer && secondaryOptions.length > 0) {
      scrollContainer.addEventListener('wheel', handleSecondaryWheel, {
        passive: false,
      });
      capsuleContainer.addEventListener('wheel', handleSecondaryWheel, {
        passive: false,
      });

      return () => {
        scrollContainer.removeEventListener('wheel', handleSecondaryWheel);
        capsuleContainer.removeEventListener('wheel', handleSecondaryWheel);
      };
    }
  }, [handleSecondaryWheel, secondaryOptions, secondary.containerRef]);

  if (!customCategories || customCategories.length === 0) {
    return null;
  }

  return (
    <div className='space-y-4 sm:space-y-6'>
      <div className='space-y-3 sm:space-y-4'>
        {/* 一级选择器 */}
        <div className='overflow-x-auto'>
          <CapsuleSelector
            options={primaryOptions}
            activeValue={primarySelection || primaryOptions[0]?.value}
            onChange={onPrimaryChange}
            containerRef={primary.containerRef}
            buttonRefs={primary.buttonRefs}
            indicatorStyle={primary.indicatorStyle}
          />
        </div>

        {/* 二级选择器 */}
        {secondaryOptions.length > 0 && (
          <div ref={secondaryScrollContainerRef} className='overflow-x-auto'>
            <CapsuleSelector
              options={secondaryOptions}
              activeValue={secondarySelection || secondaryOptions[0]?.value}
              onChange={onSecondaryChange}
              containerRef={secondary.containerRef}
              buttonRefs={secondary.buttonRefs}
              indicatorStyle={secondary.indicatorStyle}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default DoubanCustomSelector;
