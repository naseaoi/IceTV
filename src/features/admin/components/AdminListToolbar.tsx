import type { ReactNode } from 'react';

interface AdminListToolbarProps {
  search?: ReactNode;
  filters?: ReactNode;
  actions?: ReactNode;
}

export default function AdminListToolbar({
  search,
  filters,
  actions,
}: AdminListToolbarProps) {
  return (
    <div className='flex flex-wrap items-center gap-3'>
      {search && (
        <div className='min-w-0 flex-1 basis-full sm:w-72 sm:flex-none'>
          {search}
        </div>
      )}
      {(filters || actions) && (
        <div className='ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2'>
          {filters}
          {actions}
        </div>
      )}
    </div>
  );
}
