'use client';

import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import Spinner from '@/components/Spinner';
import {
  RECAP_BUTTON,
  RECAP_TEXT,
  RecapBackdrop,
} from '@/features/annual-report/components/RecapPrimitives';
import {
  RecapHeader,
  RecapShell,
  RecapStage,
  RecapStageFrame,
} from '@/features/annual-report/components/RecapStage';
import {
  type RecapAudience,
  type RecapReport,
  selfAudience,
  visitorAudience,
} from '@/features/annual-report/lib/audience';
import {
  AnnualReportError,
  fetchAnnualReport,
  fetchPublicRecap,
} from '@/features/annual-report/lib/client';

type Loaded = { report: RecapReport; audience: RecapAudience };

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retryable: boolean }
  | ({ status: 'ready' } & Loaded);

// load 需由调用方 useCallback 固定，身份变化即重新加载
function useRecapLoader(load: (signal: AbortSignal) => Promise<Loaded>) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    load(controller.signal)
      .then((loaded) => setState({ status: 'ready', ...loaded }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message:
            error instanceof AnnualReportError
              ? error.message
              : '年度报告加载失败',
          retryable: !(error instanceof AnnualReportError) || error.retryable,
        });
      });
    return () => controller.abort();
  }, [load, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, retry };
}

function RecapLoadView({
  year,
  state,
  retry,
  exitHref,
  exitLabel,
}: {
  year: number;
  state: LoadState;
  retry: () => void;
  exitHref: string;
  exitLabel: string;
}) {
  if (state.status === 'ready') {
    return (
      <RecapStage key={year} report={state.report} audience={state.audience} />
    );
  }

  return (
    <RecapShell>
      <RecapStageFrame>
        <RecapBackdrop tint='ice' />
        <RecapHeader year={year} exitHref={exitHref} />
        <div className='relative flex h-full flex-col items-center justify-center px-8 text-center'>
          {state.status === 'loading' ? (
            <>
              <Spinner className='h-7 w-7' label='正在载入年度报告' />
              <div className={`mt-4 text-sm ${RECAP_TEXT.secondary}`}>
                正在载入 {year} 年度报告
              </div>
            </>
          ) : (
            <>
              <div className={`text-base ${RECAP_TEXT.primary}`}>
                {state.message}
              </div>
              <div className='mt-6 flex gap-2.5'>
                {state.retryable && (
                  <button
                    type='button'
                    onClick={retry}
                    className={RECAP_BUTTON.primary}
                  >
                    <RefreshCw className='h-4 w-4' />
                    重试
                  </button>
                )}
                <Link href={exitHref} className={RECAP_BUTTON.secondary}>
                  {exitLabel}
                </Link>
              </div>
            </>
          )}
        </div>
      </RecapStageFrame>
    </RecapShell>
  );
}

export function AnnualReportClient({ year }: { year: number }) {
  const { session } = useAuthSession();
  const nickname =
    session.status === 'authenticated'
      ? (session.nickname ?? session.username)
      : '';
  const load = useCallback(
    async (signal: AbortSignal) => {
      const report = await fetchAnnualReport(year, signal);
      return { report, audience: selfAudience(report, nickname) };
    },
    [year, nickname],
  );
  const { state, retry } = useRecapLoader(load);
  return (
    <RecapLoadView
      year={year}
      state={state}
      retry={retry}
      exitHref='/me'
      exitLabel='返回我的'
    />
  );
}

export function PublicRecapClient({
  profileId,
  year,
}: {
  profileId: string;
  year: number;
}) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const { owner, isSelf, report, years } = await fetchPublicRecap(
        profileId,
        year,
        signal,
      );
      const audience = visitorAudience({
        profileId: owner.profileId,
        nickname: owner.nickname ?? '',
        year,
        years,
      });
      return {
        report,
        audience: isSelf ? { ...audience, you: '你' } : audience,
      };
    },
    [profileId, year],
  );
  const { state, retry } = useRecapLoader(load);
  return (
    <RecapLoadView
      year={year}
      state={state}
      retry={retry}
      exitHref={`/u/${encodeURIComponent(profileId)}`}
      exitLabel='返回主页'
    />
  );
}
