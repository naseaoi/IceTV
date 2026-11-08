import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

export default function ContinueWatchingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AuthenticatedRoute activePath='/' message='请先登录后再查看继续观看记录。'>
      {children}
    </AuthenticatedRoute>
  );
}
