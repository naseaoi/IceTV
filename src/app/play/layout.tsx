import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

export default function PlayLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedRoute
      activePath='/play'
      contentMode='player'
      message='请先登录后再播放内容。'
      showDesktopBack
    >
      {children}
    </AuthenticatedRoute>
  );
}
