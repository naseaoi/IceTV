'use client';

import type { LucideIcon } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

interface CapsuleSwitchProps {
  options: { label: string; value: string; icon?: LucideIcon }[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
}

const CapsuleSwitch: React.FC<CapsuleSwitchProps> = ({
  options,
  active,
  onChange,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState<{
    left: number;
    width: number;
  } | null>(null);

  // 计算活跃 tab 的位置和宽度
  useEffect(() => {
    const btn = buttonRefs.current.get(active);
    const container = containerRef.current;
    if (!btn || !container) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setIndicator({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
  }, [active, options]);

  return (
    <div
      ref={containerRef}
      className={`relative flex items-end ${className || ''}`}
    >
      {/* 底部贯穿分割线 */}
      <div className='absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-gray-300/60 to-transparent dark:via-white/20' />

      {/* 滑动指示器 */}
      {indicator && (
        <div
          className='pointer-events-none absolute inset-y-0 z-0 transition-all duration-300 ease-out'
          style={{
            left: indicator.left,
            width: indicator.width,
          }}
        >
          {/* 玻璃质感背景 */}
          <div
            className='absolute inset-0 bg-gradient-to-t from-blue-500/[0.08] to-transparent backdrop-blur-[4px] dark:from-white/[0.12] dark:to-transparent'
            style={{
              maskImage:
                'linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,1) 20%, rgba(0,0,0,1) 80%, rgba(0,0,0,0))',
              WebkitMaskImage:
                'linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,1) 20%, rgba(0,0,0,1) 80%, rgba(0,0,0,0))',
            }}
          />
          {/* 底部高亮指示线 */}
          <div className='absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500 to-transparent drop-shadow-[0_0_6px_rgba(59,130,246,0.5)] dark:via-white dark:drop-shadow-[0_0_6px_rgba(255,255,255,0.8)]' />
        </div>
      )}

      {options.map((opt) => {
        const isActive = active === opt.value;
        const Icon = opt.icon;
        return (
          <React.Fragment key={opt.value}>
            <button
              ref={(el) => {
                if (el) buttonRefs.current.set(opt.value, el);
              }}
              onClick={() => onChange(opt.value)}
              className={`relative cursor-pointer select-none px-6 py-3 text-sm tracking-wider transition-colors duration-500 ${
                isActive
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-400 hover:text-gray-600 dark:text-white/40 dark:hover:text-white/70'
              }`}
            >
              <span className='relative z-10 flex items-center gap-2'>
                {Icon && <Icon className='h-4 w-4' />}
                <span>{opt.label}</span>
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default CapsuleSwitch;
