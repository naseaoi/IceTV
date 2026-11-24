import { Inbox, Search } from 'lucide-react';
import type { ReactNode } from 'react';

import SkeletonText from '@/components/SkeletonText';
import Spinner from '@/components/Spinner';

// 列表区域在结果出现前后的几种状态（加载、查找、空状态骨架、空状态）共用同一框架：
// 40px 图标框 + 一行文字。同一区域的各状态再共用一个外层留白类，切换时高度不变。
const FRAME_CLASS = 'flex flex-col items-center justify-center gap-3';
const ICON_BOX_CLASS = 'flex h-10 w-10 items-center justify-center';
const LABEL_CLASS = 'text-sm leading-5';

function ListStateFrame({
  icon,
  label,
  status,
  className,
}: {
  icon: ReactNode;
  label: ReactNode;
  status?: string;
  className: string;
}) {
  return (
    <div
      role={status ? 'status' : undefined}
      aria-label={status}
      className={`${FRAME_CLASS} ${className}`}
    >
      <span aria-hidden='true' className={ICON_BOX_CLASS}>
        {icon}
      </span>
      {label}
    </div>
  );
}

// 条数未知的首次加载
export function ListLoadingState({
  label = '加载中',
  className = '',
}: {
  label?: string;
  className?: string;
}) {
  return (
    <ListStateFrame
      status={label}
      className={className}
      icon={<Spinner className='h-7 w-7 text-brand-500 dark:text-brand-400' />}
      label={
        <p className={`${LABEL_CLASS} text-gray-400 dark:text-gray-500`}>
          {label}
        </p>
      }
    />
  );
}

// 结果数量乃至有无结果都未知的查找：骨架会预告一个可能并不存在的列表
export function SearchingState({
  label = '正在搜索',
  className = '',
}: {
  label?: string;
  className?: string;
}) {
  return (
    <ListStateFrame
      status={label}
      className={className}
      icon={
        <span className='searching-orbit flex text-brand-500 dark:text-brand-400'>
          <Search className='h-7 w-7 stroke-[1.75]' />
        </span>
      }
      label={
        <p className={`${LABEL_CLASS} text-gray-400 dark:text-gray-500`}>
          {label}
        </p>
      }
    />
  );
}

// 已知为 0 时的占位：与空状态同高，计数可能是旧值，不提前显示"还没有……"
export function ListEmptySkeleton({ className = '' }: { className?: string }) {
  return (
    <ListStateFrame
      status='加载中'
      className={className}
      icon={<span className='skeleton h-10 w-10 rounded-full' />}
      label={
        <SkeletonText
          className={LABEL_CLASS}
          barClassName='h-3.5 w-28 rounded'
        />
      }
    />
  );
}

export function ListEmptyState({
  label,
  icon = <Inbox />,
  className = '',
}: {
  label: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <ListStateFrame
      className={className}
      icon={
        <span className='flex text-gray-300 dark:text-gray-600 [&>svg]:h-10 [&>svg]:w-10 [&>svg]:stroke-[1.5]'>
          {icon}
        </span>
      }
      label={
        <p className={`${LABEL_CLASS} text-gray-500 dark:text-gray-400`}>
          {label}
        </p>
      }
    />
  );
}
