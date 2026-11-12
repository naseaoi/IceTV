import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

export default function ListLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedRoute activePath='/me' message='请先登录后再查看片单。'>
      {children}
    </AuthenticatedRoute>
  );
}
