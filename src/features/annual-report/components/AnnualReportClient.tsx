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
  AnnualReportError,
  fetchAnnualReport,
} from '@/features/annual-report/lib/client';
import type { AnnualReport } from '@/features/playback-stats/types';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retryable: boolean }
  | { status: 'ready'; report: AnnualReport };

export function AnnualReportClient({ year }: { year: number }) {
  const { session } = useAuthSession();
  const nickname =
    session.status === 'authenticated'
      ? (session.nickname ?? session.username)
      : '';
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetchAnnualReport(year, controller.signal)
      .then((report) => setState({ status: 'ready', report }))
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
  }, [year, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (state.status === 'ready') {
    return <RecapStage key={year} report={state.report} nickname={nickname} />;
  }

  return (
    <RecapShell>
      <RecapStageFrame>
        <RecapBackdrop tint='ice' />
        <RecapHeader year={year} />
        <div className='relative flex h-full flex-col items-center justify-center px-8 text-center'>
          {state.status === 'loading' ? (
            <>
              <Spinner className='h-7 w-7' label='正在生成年度报告' />
              <div className={`mt-4 text-sm ${RECAP_TEXT.secondary}`}>
                正在生成 {year} 年度报告
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
                <Link href='/me' className={RECAP_BUTTON.secondary}>
                  返回我的
                </Link>
              </div>
            </>
          )}
        </div>
      </RecapStageFrame>
    </RecapShell>
  );
}
