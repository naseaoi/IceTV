import type { AnnualReport } from '@/features/playback-stats/types';

// 本人报告与公开快照共用的展示数据；公开快照没有 availableYears，且可能隐藏作息
export type RecapReport = Omit<AnnualReport, 'availableYears'> & {
  rhythmHidden?: boolean;
};

export type RecapAudience = {
  // 本人查看自己的报告时可管理公开状态
  kind: 'self' | 'visitor';
  nickname: string;
  // 叙述人称：本人「你」，访客「TA」
  you: string;
  // 除当前年外可切换的年份，降序
  otherYears: number[];
  yearHref: (year: number) => string;
  exitHref: string;
  exitLabel: string;
};

export function selfAudience(
  report: AnnualReport,
  nickname: string,
): RecapAudience {
  return {
    kind: 'self',
    nickname,
    you: '你',
    otherYears: report.availableYears.filter((year) => year !== report.year),
    yearHref: (year) => `/recap/${year}`,
    exitHref: '/me',
    exitLabel: '返回我的',
  };
}

export function visitorAudience({
  profileId,
  nickname,
  year,
  years,
}: {
  profileId: string;
  nickname: string;
  year: number;
  years: number[];
}): RecapAudience {
  const profileHref = `/u/${encodeURIComponent(profileId)}`;
  return {
    kind: 'visitor',
    nickname,
    you: 'TA',
    otherYears: years.filter((value) => value !== year),
    yearHref: (value) => `${profileHref}/recap/${value}`,
    exitHref: profileHref,
    exitLabel: '返回主页',
  };
}
