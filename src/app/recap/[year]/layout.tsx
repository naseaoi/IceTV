import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import { RecapRoot } from '@/features/annual-report/components/RecapRoot';

export default function RecapLayout({ children }: { children: ReactNode }) {
  return (
    <RecapRoot>
      <AuthenticatedRoute activePath='/me' message='请先登录后再查看年度报告。'>
        {children}
      </AuthenticatedRoute>
    </RecapRoot>
  );
}
