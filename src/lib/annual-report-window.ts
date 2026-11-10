// 年度报告开放期按用户本地日历计算：每年 12 月 20 日开放当年报告，持续到次年 2 月底。
// 入口与通知只在开放期出现；开放日之后的报告始终可通过链接查看。
const OPEN_MONTH_DAY = '12-20';
// 不含当天
const CLOSE_MONTH_DAY = '03-01';

// localDate 为 YYYY-MM-DD；不在开放期返回 null
export function openAnnualReportYear(localDate: string): number | null {
  const year = Number(localDate.slice(0, 4));
  const monthDay = localDate.slice(5, 10);
  if (monthDay >= OPEN_MONTH_DAY) return year;
  if (monthDay < CLOSE_MONTH_DAY) return year - 1;
  return null;
}

export function isAnnualReportReleased(
  year: number,
  localDate: string,
): boolean {
  return localDate >= `${year}-${OPEN_MONTH_DAY}`;
}

// 开放当天的本地日期，供通知时间等换算
export function annualReportOpenDate(year: number): string {
  return `${year}-${OPEN_MONTH_DAY}`;
}

export function annualReportNotReleasedMessage(year: number): string {
  const [month, day] = OPEN_MONTH_DAY.split('-').map(Number);
  return `${year} 年度报告将于 ${month} 月 ${day} 日开放`;
}
