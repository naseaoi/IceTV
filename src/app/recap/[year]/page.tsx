import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnnualReportClient } from '@/features/annual-report/components/AnnualReportClient';

type Params = Promise<{ year: string }>;

function parseYear(value: string): number | null {
  return /^\d{4}$/.test(value) ? Number(value) : null;
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const year = parseYear((await params).year);
  return { title: year ? `${year} 年度观影报告` : '年度观影报告' };
}

export default async function RecapPage({ params }: { params: Params }) {
  const year = parseYear((await params).year);
  if (year === null) notFound();
  return <AnnualReportClient year={year} />;
}
