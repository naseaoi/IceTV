import '@/features/annual-report/recap.css';

import type { ReactNode } from 'react';

export function RecapRoot({ children }: { children: ReactNode }) {
  return <div className='recap-root'>{children}</div>;
}

export function parseRecapYear(value: string): number | null {
  return /^\d{4}$/.test(value) ? Number(value) : null;
}
