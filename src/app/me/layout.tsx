import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';
import { SettingsLink } from '@/components/SettingsLink';
import { MeShell } from '@/features/home/components/MeShell';

export default function MeLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedRoute
      activePath='/me'
      message='请先登录后再查看个人内容。'
      mobileHeader={{
        showBack: false,
        actions: <SettingsLink className='text-gray-600 dark:text-gray-300' />,
      }}
    >
      <MeShell>{children}</MeShell>
    </AuthenticatedRoute>
  );
}
