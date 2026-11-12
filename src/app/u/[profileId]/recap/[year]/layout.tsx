import { ReactNode } from 'react';

import { RecapRoot } from '@/features/annual-report/components/RecapRoot';

// 登录门禁由 /u/[profileId] 的 layout 提供
export default function PublicRecapLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <RecapRoot>{children}</RecapRoot>;
}
