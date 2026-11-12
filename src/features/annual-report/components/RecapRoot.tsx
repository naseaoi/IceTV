import '@/features/annual-report/recap.css';

import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

// 全站只加载 400–800；报告的大号数字用细字重，只在报告路由加载
const interLight = Inter({
  subsets: ['latin'],
  weight: ['200', '300'],
  display: 'swap',
  variable: '--font-recap-light',
});

export function RecapRoot({ children }: { children: ReactNode }) {
  return <div className={`recap-root ${interLight.variable}`}>{children}</div>;
}

export function parseRecapYear(value: string): number | null {
  return /^\d{4}$/.test(value) ? Number(value) : null;
}
