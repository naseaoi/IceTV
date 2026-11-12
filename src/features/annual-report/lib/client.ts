'use client';

import type {
  AnnualRecapShareState,
  AnnualReport,
  PublicAnnualRecapResponse,
} from '@/features/playback-stats/types';
import { isAnnualReportReleased } from '@/lib/annual-report-window';

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

async function readError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  const definite = response.status >= 400 && response.status < 500;
  return new AnnualReportError(
    definite && typeof body?.error === 'string' ? body.error : fallback,
    !definite,
  );
}

export async function fetchRecapShareState(
  year: number,
  signal?: AbortSignal,
): Promise<AnnualRecapShareState> {
  const response = await fetch(
    `/api/playback-stats/annual/share?year=${year}`,
    { cache: 'no-store', signal },
  );
  if (!response.ok) throw await readError(response, '读取公开状态失败');
  return (await response.json()) as AnnualRecapShareState;
}

export async function publishRecap(
  year: number,
  hideRhythm: boolean,
): Promise<AnnualRecapShareState> {
  const response = await fetch('/api/playback-stats/annual/share', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      year,
      hideRhythm,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  if (!response.ok) throw await readError(response, '公开失败，请稍后重试');
  return (await response.json()) as AnnualRecapShareState;
}

export async function unpublishRecap(
  year: number,
): Promise<AnnualRecapShareState> {
  const response = await fetch(
    `/api/playback-stats/annual/share?year=${year}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw await readError(response, '取消公开失败，请稍后重试');
  return (await response.json()) as AnnualRecapShareState;
}

export async function fetchPublicRecap(
  profileId: string,
  year: number,
  signal?: AbortSignal,
): Promise<PublicAnnualRecapResponse> {
  const response = await fetch(
    `/api/users/${encodeURIComponent(profileId)}/recaps/${year}`,
    { cache: 'no-store', signal },
  );
  if (response.status === 404) {
    throw new AnnualReportError('这份年度报告未公开', false);
  }
  if (!response.ok) throw await readError(response, '年度报告加载失败');
  return (await response.json()) as PublicAnnualRecapResponse;
}

// 公开链接只在报告按本地日期开放后提供
export function isRecapReleasedLocally(year: number): boolean {
  const today = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return isAnnualReportReleased(year, today);
}
