import type { ReactNode } from 'react';

import { PAGE_CONTAINER_CLASS } from '@/components/page-container';

// 桌面端吸附在顶栏下方，底色与顶栏实底态一致；移动端顶栏会随滚动收起，筛选行随内容滚动
export function DoubanFilterBar({ children }: { children: ReactNode }) {
  return (
    <div className='md:sticky md:top-16 md:z-30 md:border-b md:border-gray-200/70 md:bg-gray-50/85 md:backdrop-blur-xl md:dark:border-white/[0.06] md:dark:bg-gray-950/80'>
      <div className={`${PAGE_CONTAINER_CLASS} py-3 md:min-h-[60px]`}>
        {children}
      </div>
    </div>
  );
}
