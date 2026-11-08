'use client';

import type { ReactNode } from 'react';

import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';

const ignoreSelection = () => undefined;

export function DoubanFilterLoading({ type }: { type: string }) {
  const { CUSTOM_CATEGORIES: categories } = useRuntimeConfig();
  if (type === 'custom') {
    const primary = categories.some((category) => category.type === 'movie')
      ? 'movie'
      : 'tv';
    return (
      <div inert aria-hidden='true'>
        <DoubanCustomSelector
          customCategories={categories}
          primarySelection={primary}
          secondarySelection={
            categories.find((category) => category.type === primary)?.query
          }
          onPrimaryChange={ignoreSelection}
          onSecondaryChange={ignoreSelection}
        />
      </div>
    );
  }
  return (
    <div inert aria-hidden='true'>
      <DoubanSelector
        type={type as 'movie' | 'tv' | 'show' | 'anime'}
        primarySelection={
          type === 'movie' ? '热门' : type === 'anime' ? '每日放送' : '最近热门'
        }
        secondarySelection={
          type === 'tv' ? 'tv' : type === 'show' ? 'show' : '全部'
        }
        onPrimaryChange={ignoreSelection}
        onSecondaryChange={ignoreSelection}
        onWeekdayChange={ignoreSelection}
      />
    </div>
  );
}

// 桌面端吸附在顶栏下方，底色与顶栏实底态一致；移动端顶栏会随滚动收起，筛选行随内容滚动
export function DoubanFilterBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-nav-subbar
      className='md:sticky md:top-16 md:z-30 md:border-b md:border-gray-200/70 md:bg-gray-50 md:dark:border-white/[0.06] md:dark:bg-gray-950'
    >
      <div className={`${PAGE_CONTAINER_CLASS} py-3 md:min-h-[60px]`}>
        {children}
      </div>
    </div>
  );
}
