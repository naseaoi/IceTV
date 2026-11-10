import {
  annualReportNotReleasedMessage,
  annualReportOpenDate,
  isAnnualReportReleased,
  openAnnualReportYear,
} from '@/lib/annual-report-window';

describe('annual report window', () => {
  it.each([
    ['2026-12-19', null],
    ['2026-12-20', 2026],
    ['2026-12-31', 2026],
    ['2027-01-01', 2026],
    ['2027-02-28', 2026],
    ['2028-02-29', 2027],
    ['2027-03-01', null],
    ['2026-11-10', null],
  ])('openAnnualReportYear(%s) = %s', (date, expected) => {
    expect(openAnnualReportYear(date)).toBe(expected);
  });

  it('keeps released reports viewable after the window closes', () => {
    expect(isAnnualReportReleased(2026, '2026-12-19')).toBe(false);
    expect(isAnnualReportReleased(2026, '2026-12-20')).toBe(true);
    expect(isAnnualReportReleased(2026, '2027-06-01')).toBe(true);
    expect(isAnnualReportReleased(2027, '2027-06-01')).toBe(false);
  });

  it('derives the open date and message from the same rule', () => {
    expect(annualReportOpenDate(2026)).toBe('2026-12-20');
    expect(annualReportNotReleasedMessage(2026)).toBe(
      '2026 年度报告将于 12 月 20 日开放',
    );
  });
});
