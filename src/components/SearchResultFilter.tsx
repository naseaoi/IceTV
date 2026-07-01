'use client';

import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

  const calculateDropdownPosition = (categoryKey: SearchFilterKey) => {
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
  };

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
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    return () => {
      document.body.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [activeCategory]);

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
      <div className='relative inline-flex gap-1 rounded-full bg-transparent p-0.5 sm:gap-2 sm:p-1'>
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
              className={`relative z-10 whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs font-medium transition-all duration-200 sm:px-2 sm:py-1 sm:text-sm md:px-4 md:py-2 ${
                activeCategory === category.key
                  ? isDefaultValue(category.key)
                    ? 'cursor-default text-gray-900 dark:text-gray-100'
                    : 'cursor-default text-green-600 dark:text-green-400'
                  : isDefaultValue(category.key)
                    ? 'cursor-pointer text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                    : 'cursor-pointer text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300'
              }`}
            >
              <span>{getDisplayText(category.key)}</span>
              <svg
                className={`ml-0.5 inline-block h-2.5 w-2.5 transition-transform duration-200 sm:ml-1 sm:h-3 sm:w-3 ${activeCategory === category.key ? 'rotate-180' : ''}`}
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
            className={`relative z-10 whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs font-medium transition-all duration-200 sm:px-2 sm:py-1 sm:text-sm md:px-4 md:py-2 ${
              mergedValues.yearOrder === 'none'
                ? 'cursor-pointer text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                : 'cursor-pointer text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300'
            }`}
            aria-label={`按年份${mergedValues.yearOrder === 'none' ? '排序' : mergedValues.yearOrder === 'desc' ? '降序' : '升序'}排序`}
          >
            <span>年份</span>
            {mergedValues.yearOrder === 'none' ? (
              <ArrowUpDown className='ml-1 inline-block h-4 w-4 sm:h-4 sm:w-4' />
            ) : mergedValues.yearOrder === 'desc' ? (
              <ArrowDownWideNarrow className='ml-1 inline-block h-4 w-4 sm:h-4 sm:w-4' />
            ) : (
              <ArrowUpNarrowWide className='ml-1 inline-block h-4 w-4 sm:h-4 sm:w-4' />
            )}
          </button>
        </div>
      </div>

      {activeCategory &&
        createPortal(
          <div
            ref={dropdownRef}
            className='fixed z-[9999] flex flex-col rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10'
            style={{
              left: `${dropdownPosition.x}px`,
              top: `${dropdownPosition.y}px`,
              width: `${dropdownPosition.width}px`,
              maxWidth: activeCategory === 'title' ? '720px' : '600px',
              maxHeight:
                activeCategory === 'title' ? 'min(60vh, 520px)' : '50vh',
              position: 'fixed',
            }}
          >
            <div className='min-h-0 flex-1 overflow-y-auto p-2 sm:p-4'>
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
                          ? 'border border-green-200 bg-green-100 text-green-700 dark:border-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'text-gray-700 hover:bg-gray-100/80 dark:text-gray-300 dark:hover:bg-gray-700/80'
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
