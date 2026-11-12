import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

export default function ContinueWatchingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AuthenticatedRoute
      activePath='/continue-watching'
      message='请先登录后再查看继续观看记录。'
      mobileHeader={{ title: '继续观看', showBack: true }}
    >
      {children}
    </AuthenticatedRoute>
  );
}
