'use client';

import { type LucideIcon, Check, ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { usePresence } from '@/hooks/usePresence';
import { snapToDevicePixel } from '@/lib/pixel-snap';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface SelectProps {
  id?: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  showSelectedIcon?: boolean;
  // field：表单内整宽输入框；pill：工具栏里的紧凑胶囊
  variant?: 'field' | 'pill';
  icon?: LucideIcon;
  // 菜单对齐触发器的哪一侧，靠右的工具栏用 end 防止溢出
  align?: 'start' | 'end';
}

const TRIGGER_CLASS = {
  field:
    'w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-left text-sm text-gray-900 shadow-sm transition-all duration-200 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100',
  pill: 'inline-flex h-8 items-center gap-1.5 rounded-full pl-2.5 pr-2 text-[13px] font-medium text-gray-600 transition-colors hover:bg-white/75 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 aria-expanded:bg-white/75 aria-expanded:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-white dark:aria-expanded:bg-white/[0.06] dark:aria-expanded:text-white',
} as const;

const TRIGGER_STATE_CLASS = {
  field: {
    enabled: 'cursor-pointer hover:border-gray-400 dark:hover:border-gray-500',
    disabled: 'cursor-not-allowed opacity-50',
  },
  pill: {
    enabled: 'cursor-pointer',
    disabled: 'cursor-not-allowed opacity-50',
  },
} as const;

const POPOVER_EXIT_MS = 200;
const POPOVER_GAP = 6;
const POPOVER_MAX_HEIGHT = 288;
const VIEWPORT_GAP = 8;

export default function Select({
  id,
  ariaLabel,
  value,
  onChange,
  options,
  placeholder = '请选择',
  className = '',
  disabled = false,
  showSelectedIcon = true,
  variant = 'field',
  icon: Icon,
  align = 'start',
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const presence = usePresence(isOpen && !disabled, POPOVER_EXIT_MS);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listboxId = useId();

  const selectedIndex = options.findIndex((opt) => opt.value === value);
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // 下拉挂到 body 上按触发器定位，避免被弹窗、面板等滚动容器裁切；下方放不下时向上展开
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (variant === 'field') popover.style.width = `${rect.width}px`;
    else popover.style.minWidth = `${rect.width}px`;
    popover.style.maxWidth = `${viewportWidth - VIEWPORT_GAP * 2}px`;
    popover.style.maxHeight = `${POPOVER_MAX_HEIGHT}px`;

    const spaceBelow =
      viewportHeight - rect.bottom - POPOVER_GAP - VIEWPORT_GAP;
    const spaceAbove = rect.top - POPOVER_GAP - VIEWPORT_GAP;
    const openUp = popover.offsetHeight > spaceBelow && spaceAbove > spaceBelow;
    popover.style.maxHeight = `${Math.min(
      POPOVER_MAX_HEIGHT,
      Math.max(openUp ? spaceAbove : spaceBelow, 0),
    )}px`;
    popover.style.top = `${snapToDevicePixel(
      openUp
        ? rect.top - POPOVER_GAP - popover.offsetHeight
        : rect.bottom + POPOVER_GAP,
    )}px`;

    const width = popover.offsetWidth;
    const left = align === 'end' ? rect.right - width : rect.left;
    popover.style.left = `${snapToDevicePixel(
      Math.max(
        VIEWPORT_GAP,
        Math.min(left, viewportWidth - width - VIEWPORT_GAP),
      ),
    )}px`;
    popover.style.setProperty(
      '--popover-origin',
      `${openUp ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`,
    );
    popover.style.setProperty('--popover-shift', openUp ? '6px' : '-6px');
  }, [align, variant]);

  useLayoutEffect(() => {
    if (!presence.mounted) return;
    place();
  }, [presence.mounted, place, options]);

  useEffect(() => {
    if (!presence.mounted) return;
    const handleScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [presence.mounted, place]);

  useEffect(() => {
    if (!isOpen || !presence.mounted) return;
    const target =
      optionRefs.current[selectedIndex] ??
      optionRefs.current.find((option) => option && !option.disabled);
    target?.focus();
  }, [isOpen, presence.mounted, selectedIndex]);

  const close = (restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const select = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    close(true);
  };

  const focusSibling = (from: number, step: 1 | -1) => {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index =
        (from + step * offset + options.length * offset) % options.length;
      if (!options[index].disabled) {
        optionRefs.current[index]?.focus();
        return;
      }
    }
  };

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusSibling(index, 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusSibling(index, -1);
        break;
      case 'Home':
        event.preventDefault();
        focusSibling(-1, 1);
        break;
      case 'End':
        event.preventDefault();
        focusSibling(options.length, -1);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  const stateClass =
    TRIGGER_STATE_CLASS[variant][disabled ? 'disabled' : 'enabled'];

  return (
    <div
      ref={containerRef}
      className={`relative ${variant === 'pill' ? 'inline-flex' : ''} ${className}`}
    >
      <button
        ref={triggerRef}
        id={id}
        type='button'
        aria-label={ariaLabel}
        aria-haspopup='listbox'
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
        className={`${TRIGGER_CLASS[variant]} ${stateClass}`}
      >
        {Icon && (
          <Icon aria-hidden='true' className='h-3.5 w-3.5 text-gray-400' />
        )}
        <span
          className={selectedOption ? '' : 'text-gray-400 dark:text-gray-500'}
        >
          {selectedOption?.label || placeholder}
        </span>
        {variant === 'pill' && (
          <ChevronDown
            aria-hidden='true'
            className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {variant === 'field' && (
        <div className='pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3'>
          <ChevronDown
            className={`h-4 w-4 text-gray-400 transition-transform duration-200 dark:text-gray-500 ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      )}

      {presence.mounted &&
        createPortal(
          <div
            ref={popoverRef}
            id={listboxId}
            role='listbox'
            aria-label={ariaLabel}
            data-open={presence.visible}
            className={`motion-popover fixed left-0 top-0 z-[10000] overflow-auto rounded-xl bg-white p-1 shadow-xl shadow-black/[0.08] ring-1 ring-black/[0.08] dark:bg-gray-900 dark:shadow-black/40 dark:ring-white/10 ${
              variant === 'field' ? '' : 'w-max'
            }`}
          >
            {options.map((opt, index) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  type='button'
                  role='option'
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  title={opt.disabledReason}
                  onClick={() => select(opt)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors duration-150 ${
                    opt.disabled
                      ? 'cursor-not-allowed text-gray-400 dark:text-gray-500'
                      : isSelected
                        ? 'font-medium text-brand-600 hover:bg-brand-500/10 focus-visible:bg-brand-500/10 dark:text-brand-400'
                        : 'text-gray-700 hover:bg-gray-100 focus-visible:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]'
                  }`}
                >
                  <span className='flex min-w-0 items-center gap-2'>
                    <span className='truncate'>{opt.label}</span>
                    {opt.disabledReason && (
                      <span className='shrink-0 text-xs text-rose-500 dark:text-rose-400'>
                        {opt.disabledReason}
                      </span>
                    )}
                  </span>
                  {isSelected && showSelectedIcon && (
                    <Check className='h-4 w-4 flex-shrink-0' />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
