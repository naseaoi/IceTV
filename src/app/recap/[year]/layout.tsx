import '@/features/annual-report/recap.css';

import { Inter } from 'next/font/google';
import { ReactNode } from 'react';

import AuthenticatedRoute from '@/components/AuthenticatedRoute';

// 全站只加载 400–800；报告的大号数字用细字重，只在本路由加载
const interLight = Inter({
  subsets: ['latin'],
  weight: ['200', '300'],
  display: 'swap',
  variable: '--font-recap-light',
});

export default function RecapLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`recap-root ${interLight.variable}`}>
      <AuthenticatedRoute activePath='/me' message='请先登录后再查看年度报告。'>
        {children}
      </AuthenticatedRoute>
    </div>
  );
}
