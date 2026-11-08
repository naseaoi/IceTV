'use client';

import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
} from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { subscribePageScroll } from '@/hooks/usePageScroll';

type SearchFilterKey = 'source' | 'title' | 'year' | 'yearOrder';

interface SearchFilterOption {
  label: string;
  value: string;
}

export interface SearchFilterCategory {
  key: SearchFilterKey;
  label: string;
  options: SearchFilterOption[];
}

interface SearchResultFilterProps {
  categories: SearchFilterCategory[];
  values: Partial<Record<SearchFilterKey, string>>;
  onChange: (values: Record<SearchFilterKey, string>) => void;
}

const TRIGGER_CLASS =
  'relative z-10 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-colors duration-200';

const DEFAULTS: Record<SearchFilterKey, string> = {
  source: 'all',
  title: 'all',
  year: 'all',
  yearOrder: 'none',
};

function estimateTextWidth(text: string): number {
  return Array.from(text).reduce((width, char) => {
    if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(char)) {
      return width + 15;
    }
    if (/[A-Z0-9]/.test(char)) {
      return width + 9;
    }
    return width + 7;
  }, 0);
}

function clampPanelWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(Math.max(width, minWidth), maxWidth);
}

const SearchResultFilter: React.FC<SearchResultFilterProps> = ({
  categories,
  values,
  onChange,
}) => {
  const [activeCategory, setActiveCategory] = useState<SearchFilterKey | null>(
    null,
  );
  const [dropdownPosition, setDropdownPosition] = useState<{
    x: number;
    y: number;
    width: number;
  }>({ x: 0, y: 0, width: 0 });
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  const mergedValues = useMemo(() => {
    return {
      ...DEFAULTS,
      ...values,
    } as Record<SearchFilterKey, string>;
  }, [values]);

  const calculateDropdownPosition = useCallback(
    (categoryKey: SearchFilterKey) => {
      const element = categoryRefs.current[categoryKey];
      if (element) {
        const rect = element.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const isMobile = viewportWidth < 768;
        const category = categories.find((cat) => cat.key === categoryKey);
        const maxOptionTextWidth = Math.max(
          0,
          ...(category?.options || []).map((option) =>
            estimateTextWidth(option.label),
          ),
        );
        const minWidth = categoryKey === 'title' ? 280 : 120;
        const maxWidth = categoryKey === 'title' ? 640 : 420;
        const contentWidth =
          categoryKey === 'title'
            ? maxOptionTextWidth + 56
            : maxOptionTextWidth + 40;

        let x = rect.left;
        let dropdownWidth = clampPanelWidth(
          Math.max(rect.width, contentWidth),
          minWidth,
          maxWidth,
        );

        if (isMobile) {
          const padding = 16;
          const maxWidth = viewportWidth - padding * 2;
          dropdownWidth = Math.min(dropdownWidth, maxWidth);

          if (x + dropdownWidth > viewportWidth - padding) {
            x = viewportWidth - dropdownWidth - padding;
          }
          if (x < padding) {
            x = padding;
          }
        }

        setDropdownPosition({
          x,
          y: rect.bottom,
          width: dropdownWidth,
        });
      }
    },
    [categories],
  );

  const handleCategoryClick = (categoryKey: SearchFilterKey) => {
    if (activeCategory === categoryKey) {
      setActiveCategory(null);
    } else {
      setActiveCategory(categoryKey);
      calculateDropdownPosition(categoryKey);
    }
  };

  const handleOptionSelect = (
    categoryKey: SearchFilterKey,
    optionValue: string,
  ) => {
    const newValues = {
      ...mergedValues,
      [categoryKey]: optionValue,
    } as Record<SearchFilterKey, string>;
    onChange(newValues);
    setActiveCategory(null);
  };

  const getDisplayText = (categoryKey: SearchFilterKey) => {
    const category = categories.find((cat) => cat.key === categoryKey);
    if (!category) return '';
    const value = mergedValues[categoryKey];
    if (!value || value === DEFAULTS[categoryKey]) return category.label;
    const option = category.options.find((opt) => opt.value === value);
    return option?.label || category.label;
  };

  const isDefaultValue = (categoryKey: SearchFilterKey) => {
    const value = mergedValues[categoryKey];
    return !value || value === DEFAULTS[categoryKey];
  };

  const isOptionSelected = (
    categoryKey: SearchFilterKey,
    optionValue: string,
  ) => {
    const value = mergedValues[categoryKey] ?? DEFAULTS[categoryKey];
    return value === optionValue;
  };

  useEffect(() => {
    const handleScroll = () => {
      if (activeCategory) {
        setActiveCategory(null);
      }
    };
    const handleResize = () => {
      if (activeCategory) calculateDropdownPosition(activeCategory);
    };
    const unsubscribeScroll = subscribePageScroll(handleScroll);
    window.addEventListener('resize', handleResize);
    return () => {
      unsubscribeScroll();
      window.removeEventListener('resize', handleResize);
    };
  }, [activeCategory, calculateDropdownPosition]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !Object.values(categoryRefs.current).some(
          (ref) => ref && ref.contains(event.target as Node),
        )
      ) {
        setActiveCategory(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      <div className='scrollbar-hide relative inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-gray-900/[0.05] p-1 dark:bg-white/[0.06]'>
        {categories.map((category) => (
          <div
            key={category.key}
            ref={(el) => {
              categoryRefs.current[category.key] = el;
            }}
            className='relative'
          >
            <button
              onClick={() => handleCategoryClick(category.key)}
              aria-expanded={activeCategory === category.key}
              className={`${TRIGGER_CLASS} ${
                activeCategory === category.key
                  ? 'bg-white shadow-sm dark:bg-white/[0.14]'
                  : ''
              } ${
                isDefaultValue(category.key)
                  ? 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                  : 'text-brand-600 dark:text-brand-300'
              }`}
            >
              <span>{getDisplayText(category.key)}</span>
              <svg
                className={`h-3 w-3 opacity-60 transition-transform duration-200 ${activeCategory === category.key ? 'rotate-180' : ''}`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M19 9l-7 7-7-7'
                />
              </svg>
            </button>
          </div>
        ))}
        {/* 通用年份排序切换按钮 */}
        <div className='relative'>
          <button
            onClick={() => {
              let next;
              switch (mergedValues.yearOrder) {
                case 'none':
                  next = 'desc';
                  break;
                case 'desc':
                  next = 'asc';
                  break;
                case 'asc':
                  next = 'none';
                  break;
                default:
                  next = 'desc';
              }
              onChange({ ...mergedValues, yearOrder: next });
            }}
            className={`${TRIGGER_CLASS} ${
              mergedValues.yearOrder === 'none'
                ? 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                : 'text-brand-600 dark:text-brand-300'
            }`}
            aria-label={`按年份${mergedValues.yearOrder === 'none' ? '排序' : mergedValues.yearOrder === 'desc' ? '降序' : '升序'}排序`}
          >
            <span>年份</span>
            {mergedValues.yearOrder === 'none' ? (
              <ArrowUpDown className='h-3.5 w-3.5' />
            ) : mergedValues.yearOrder === 'desc' ? (
              <ArrowDownWideNarrow className='h-3.5 w-3.5' />
            ) : (
              <ArrowUpNarrowWide className='h-3.5 w-3.5' />
            )}
          </button>
        </div>
      </div>

      {activeCategory &&
        createPortal(
          <div
            ref={dropdownRef}
            className='fixed z-[9999] flex flex-col rounded-2xl bg-white shadow-2xl shadow-black/10 ring-1 ring-gray-900/[0.08] dark:bg-gray-900 dark:shadow-black/50 dark:ring-white/[0.08]'
            style={{
              left: `${dropdownPosition.x}px`,
              top: `${dropdownPosition.y + 6}px`,
              width: `${dropdownPosition.width}px`,
              maxWidth: activeCategory === 'title' ? '720px' : '600px',
              maxHeight:
                activeCategory === 'title' ? 'min(60vh, 520px)' : '50vh',
              position: 'fixed',
            }}
          >
            <div className='min-h-0 flex-1 overflow-y-auto p-2'>
              <div
                className={
                  activeCategory === 'title'
                    ? 'flex flex-col gap-1'
                    : 'flex flex-wrap gap-1 sm:gap-2'
                }
              >
                {categories
                  .find((cat) => cat.key === activeCategory)
                  ?.options.map((option) => (
                    <button
                      key={option.value}
                      onClick={() =>
                        handleOptionSelect(activeCategory, option.value)
                      }
                      className={`rounded-lg px-2 py-1.5 text-left text-xs transition-all duration-200 sm:px-3 sm:py-2 sm:text-sm ${
                        activeCategory === 'title'
                          ? 'w-full'
                          : 'whitespace-nowrap'
                      } ${
                        isOptionSelected(activeCategory, option.value)
                          ? 'bg-brand-500/10 font-medium text-brand-700 dark:text-brand-300'
                          : 'text-gray-700 hover:bg-gray-900/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      <span
                        className={
                          activeCategory === 'title'
                            ? 'block truncate'
                            : 'block'
                        }
                      >
                        {option.label}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default SearchResultFilter;
