'use client';

import type { AnnualReport } from '@/features/playback-stats/types';

// 4xx 是确定的结果（年份无效、尚未开放），重试无意义
export class AnnualReportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function fetchAnnualReport(
  year: number,
  signal?: AbortSignal,
): Promise<AnnualReport> {
  const params = new URLSearchParams({
    year: String(year),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const response = await fetch(`/api/playback-stats/annual?${params}`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const definite = response.status === 400 || response.status === 403;
    throw new AnnualReportError(
      definite && typeof body?.error === 'string'
        ? body.error
        : '年度报告加载失败',
      !definite,
    );
  }
  return (await response.json()) as AnnualReport;
}
