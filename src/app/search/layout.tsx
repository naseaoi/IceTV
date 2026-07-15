import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

export default function SearchLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedRoute
      activePath='/search'
      message='请先登录后再使用搜索功能。'
    >
      {children}
    </AuthenticatedRoute>
  );
}
