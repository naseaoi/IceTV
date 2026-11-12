'use client';

import React, { useEffect, useRef, useState } from 'react';

import { useClientHydrated } from '@/hooks/useClientHydrated';

interface WeekdaySelectorProps {
  value: string;
  onChange: (weekday: string) => void;
  className?: string;
}

const weekdays = [
  { value: 'Mon', label: '周一', shortLabel: '周一' },
  { value: 'Tue', label: '周二', shortLabel: '周二' },
  { value: 'Wed', label: '周三', shortLabel: '周三' },
  { value: 'Thu', label: '周四', shortLabel: '周四' },
  { value: 'Fri', label: '周五', shortLabel: '周五' },
  { value: 'Sat', label: '周六', shortLabel: '周六' },
  { value: 'Sun', label: '周日', shortLabel: '周日' },
];

const WeekdaySelector: React.FC<WeekdaySelectorProps> = ({
  value,
  onChange,
  className = '',
}) => {
  // 默认星期取自本地时区，服务端渲染的时区可能不同，水合后再高亮
  const hydrated = useClientHydrated();
  const selectedWeekday = hydrated ? value : '';
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  // 更新指示器位置
  const updateIndicatorPosition = (activeIndex: number) => {
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
  };

  useEffect(() => {
    const activeIndex = weekdays.findIndex((w) => w.value === selectedWeekday);
    const cleanup = updateIndicatorPosition(activeIndex);
    return cleanup;
  }, [selectedWeekday]);

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex rounded-full bg-gray-900/[0.05] p-1 dark:bg-white/[0.06] ${className}`}
    >
      {/* 滑动的白色背景指示器 */}
      {indicatorStyle.width > 0 && (
        <div
          className='absolute bottom-1 top-1 rounded-full bg-white shadow-sm transition-all duration-300 ease-out dark:bg-white/[0.14]'
          style={{
            left: `${indicatorStyle.left}px`,
            width: `${indicatorStyle.width}px`,
          }}
        />
      )}

      {weekdays.map((weekday, index) => {
        const isActive = selectedWeekday === weekday.value;
        return (
          <button
            key={weekday.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            onClick={() => onChange(weekday.value)}
            className={`relative z-10 whitespace-nowrap rounded-full px-3 py-1 text-[13px] transition-colors duration-200 sm:px-3.5 sm:py-1.5 sm:text-sm ${
              isActive
                ? 'cursor-default text-gray-900 dark:text-gray-100'
                : 'cursor-pointer text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
            title={weekday.label}
          >
            {weekday.shortLabel}
          </button>
        );
      })}
    </div>
  );
};

export default WeekdaySelector;
