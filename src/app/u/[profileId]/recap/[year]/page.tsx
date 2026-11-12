import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PublicRecapClient } from '@/features/annual-report/components/AnnualReportClient';
import { parseRecapYear } from '@/features/annual-report/components/RecapRoot';

type Params = Promise<{ profileId: string; year: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const year = parseRecapYear((await params).year);
  return { title: year ? `${year} 年度观影报告` : '年度观影报告' };
}

export default async function PublicRecapPage({ params }: { params: Params }) {
  const { profileId, year: rawYear } = await params;
  const year = parseRecapYear(rawYear);
  if (year === null) notFound();
  return (
    <PublicRecapClient
      key={`${profileId}-${year}`}
      profileId={profileId}
      year={year}
    />
  );
}
