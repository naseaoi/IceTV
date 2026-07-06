'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface IndicatorStyle {
  left: number;
  width: number;
}

interface SelectorOption {
  label: string;
  value: string;
}

/**
 * 胶囊选择器的滑动指示器逻辑
 * 管理 refs、indicator 位置计算和渲染
 */
export function useCapsuleIndicator() {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<IndicatorStyle>({
    left: 0,
    width: 0,
  });

  /** 根据激活项索引更新指示器位置，返回清理函数 */
  const updatePosition = useCallback((activeIndex: number) => {
    if (
      activeIndex >= 0 &&
      buttonRefs.current[activeIndex] &&
      containerRef.current
    ) {
      const timeoutId = setTimeout(() => {
        const button = buttonRefs.current[activeIndex];
        const container = containerRef.current;
        if (button && container) {
          const buttonRect = button.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          if (buttonRect.width > 0) {
            setIndicatorStyle({
              left: buttonRect.left - containerRect.left,
              width: buttonRect.width,
            });
          }
        }
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, []);

  return { containerRef, buttonRefs, indicatorStyle, updatePosition };
}

/**
 * 渲染胶囊式选择器 UI
 */
export function CapsuleSelector({
  options,
  activeValue,
  onChange,
  containerRef,
  buttonRefs,
  indicatorStyle,
}: {
  options: SelectorOption[];
  activeValue: string | undefined;
  onChange: (value: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  buttonRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>;
  indicatorStyle: IndicatorStyle;
}) {
  return (
    <div
      ref={containerRef}
      className='relative inline-flex rounded-lg bg-gray-200/60 p-0.5 backdrop-blur-sm dark:bg-gray-700/60 sm:p-1'
    >
      {indicatorStyle.width > 0 && (
        <div
          className='absolute bottom-0.5 top-0.5 rounded-lg bg-white shadow-sm transition-all duration-300 ease-out dark:bg-gray-500 sm:bottom-1 sm:top-1'
          style={{
            left: `${indicatorStyle.left}px`,
            width: `${indicatorStyle.width}px`,
          }}
        />
      )}

      {options.map((option, index) => {
        const isActive = activeValue === option.value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            onClick={() => onChange(option.value)}
            className={`relative z-10 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-medium transition-all duration-200 sm:px-4 sm:py-2 sm:text-sm ${
              isActive
                ? 'cursor-default text-gray-900 dark:text-gray-100'
                : 'cursor-pointer text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 自动同步指示器位置的 effect hook
 * @param options 选项列表
 * @param activeValue 当前选中值
 * @param defaultValue 默认值（首次渲染时用）
 * @param updatePosition 来自 useCapsuleIndicator 的位置更新函数
 */
export function useSyncIndicator(
  options: SelectorOption[],
  activeValue: string | undefined,
  defaultValue: string,
  updatePosition: (activeIndex: number) => (() => void) | undefined,
) {
  // 选中值变化或选项列表变化时更新位置
  useEffect(() => {
    if (options.length === 0) return;
    const effectiveValue = activeValue ?? defaultValue;
    const idx = options.findIndex((opt) => opt.value === effectiveValue);
    return updatePosition(idx);
  }, [activeValue, options, defaultValue, updatePosition]);
}
