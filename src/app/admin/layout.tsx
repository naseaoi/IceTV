import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthenticatedRoute
      activePath='/admin'
      forbiddenMessage='当前账号没有后台访问权限。'
      message='请先登录管理员账号后再进入后台。'
      requiredRole='admin'
    >
      {children}
    </AuthenticatedRoute>
  );
}
