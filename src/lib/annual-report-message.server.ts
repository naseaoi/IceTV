import 'server-only';

import {
  dateFormatter,
  localDate,
  localMidnight,
} from '@/features/playback-stats/lib/period';
import {
  annualReportOpenDate,
  openAnnualReportYear,
} from '@/lib/annual-report-window';
import { db } from '@/lib/db';
import type { AnnualReportUserMessage } from '@/lib/message-types';
import type { UserMessageState } from '@/lib/types';

export async function getAnnualReportMessage(
  userName: string,
  state: UserMessageState,
  timeZone: string,
  now = Date.now(),
): Promise<AnnualReportUserMessage | null> {
  const formatter = dateFormatter(timeZone);
  const year = openAnnualReportYear(localDate(formatter, now));
  if (year === null || year <= (state.annualReportReadYear ?? 0)) return null;
  const midnight = (date: string) =>
    localMidnight(new Date(`${date}T00:00:00Z`), formatter);
  if (
    !(await db.hasPlaybackAnnualActivity(
      userName,
      midnight(`${year}-01-01`),
      midnight(`${year + 1}-01-01`),
    ))
  )
    return null;
  return {
    id: `annual-report:${year}`,
    type: 'annual-report',
    year,
    createdAt: midnight(annualReportOpenDate(year)),
  };
}
