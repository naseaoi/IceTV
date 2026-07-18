import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

export default function LiveLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedRoute activePath='/live' message='请先登录后再观看直播。'>
      {children}
    </AuthenticatedRoute>
  );
}
