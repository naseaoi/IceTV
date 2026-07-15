import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

export default function MeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedRoute activePath='/me' message='请先登录后再查看个人内容。'>
      {children}
    </AuthenticatedRoute>
  );
}
