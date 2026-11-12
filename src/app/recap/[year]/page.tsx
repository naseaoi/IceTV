import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AnnualReportClient } from '@/features/annual-report/components/AnnualReportClient';
import { parseRecapYear } from '@/features/annual-report/components/RecapRoot';

type Params = Promise<{ year: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const year = parseRecapYear((await params).year);
  return { title: year ? `${year} 年度观影报告` : '年度观影报告' };
}

export default async function RecapPage({ params }: { params: Params }) {
  const year = parseRecapYear((await params).year);
  if (year === null) notFound();
  return <AnnualReportClient year={year} />;
}
