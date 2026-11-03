import type { ReactNode } from 'react';

import { PAGE_CONTAINER_CLASS } from '@/components/page-container';

// 吸附在顶栏下方，底色与顶栏实底态一致
export function DoubanFilterBar({ children }: { children: ReactNode }) {
  return (
    <div className='sticky top-16 z-30 hidden border-b border-gray-200/70 bg-gray-50/85 backdrop-blur-xl dark:border-white/[0.06] dark:bg-gray-950/80 md:block'>
      <div className={`${PAGE_CONTAINER_CLASS} min-h-[60px] py-3`}>
        {children}
      </div>
    </div>
  );
}
