'use client';

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  RefreshCw,
  Search,
  X,
  Zap,
} from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';

import LoadingStatePanel from '@/components/LoadingStatePanel';
import PageLayout from '@/components/PageLayout';

type LoadingStage = 'searching' | 'preferring' | 'fetching' | 'ready';

interface PlayLoadingViewProps {
  loadingStage: LoadingStage;
  loadingMessage: string;
  onBack?: () => void;
}

interface PlayErrorViewProps {
  error: string;
  onBack: () => void;
  onRetry: () => void;
}

function getLoadingStageIcon(loadingStage: LoadingStage): ReactNode {
  if (loadingStage === 'searching') {
    return <Search className='h-10 w-10' />;
  }
  if (loadingStage === 'preferring') {
    return <Zap className='h-10 w-10' />;
  }
  if (loadingStage === 'fetching') {
    return <Clapperboard className='h-10 w-10' />;
  }
  return <CheckCircle2 className='h-10 w-10' />;
}

/**
 * 平滑进度 hook：进度条从当前值平滑过渡到目标值，
 * 到达目标后以极慢速率继续爬升（不超过下一阶段 -1），
 * 确保进度条始终有"仍在进行中"的视觉反馈。
 */
function useSmoothProgress(targetProgress: number) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(0);
  const currentRef = useRef(0);
  const prevTargetRef = useRef(0);
  // 到达目标后的蠕动帧计数
  const creepFrameRef = useRef(0);

  useEffect(() => {
    const prevTarget = prevTargetRef.current;
    prevTargetRef.current = targetProgress;
    // 目标变化时重置蠕动帧计数
    creepFrameRef.current = 0;

    // 阶段跳变（目标值大幅变化）时，先快速追到前一个目标附近
    if (targetProgress - prevTarget > 10) {
      currentRef.current = Math.max(currentRef.current, prevTarget - 2);
    }

    const animate = () => {
      const target = targetProgress;
      const cur = currentRef.current;

      if (cur < target) {
        // 追赶阶段：固定步进
        const step = 0.5;
        currentRef.current = Math.min(cur + step, target);
        setDisplay(Math.round(currentRef.current));
      } else if (target < 100) {
        // 蠕动阶段：到达当前目标后缓慢爬升，但不超过 target + 20（给下一阶段留空间）
        // 每 8 帧（约 133ms）爬升 0.1%，视觉上是极慢的蠕动
        creepFrameRef.current += 1;
        if (creepFrameRef.current % 8 === 0) {
          const ceiling = Math.min(target + 20, 99);
          if (cur < ceiling) {
            currentRef.current = cur + 0.1;
            setDisplay(Math.round(currentRef.current));
          }
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [targetProgress]);

  return display;
}

export function PlayLoadingView({
  loadingStage,
  loadingMessage,
  onBack,
}: PlayLoadingViewProps) {
  // 各阶段进度百分比映射，确保进度条每段增量一致（均为 25%）
  const stageProgressMap: Record<LoadingStage, number> = {
    searching: 25,
    preferring: 50,
    fetching: 75,
    ready: 100,
  };
  const rawProgress = stageProgressMap[loadingStage] ?? 0;
  const loadingProgress = useSmoothProgress(rawProgress);

  return (
    <PageLayout activePath='/play'>
      <div className='flex h-full items-center justify-center'>
        <div className='flex w-full max-w-2xl flex-col items-center gap-4 px-4'>
          <LoadingStatePanel
            icon={getLoadingStageIcon(loadingStage)}
            tone='emerald'
            glow
            title='正在加载'
            message={loadingMessage}
            progress={loadingProgress}
          />
          <button
            onClick={onBack}
            aria-label='取消加载'
            title='取消加载'
            disabled={!onBack}
            aria-hidden={!onBack}
            tabIndex={onBack ? 0 : -1}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition-colors dark:bg-gray-800 dark:text-gray-200 ${
              onBack
                ? 'hover:bg-gray-200 dark:hover:bg-gray-700'
                : 'pointer-events-none invisible'
            }`}
          >
            <X className='h-5 w-5' />
          </button>
        </div>
      </div>
    </PageLayout>
  );
}

export function PlayErrorView({ error, onBack, onRetry }: PlayErrorViewProps) {
  return (
    <PageLayout activePath='/play'>
      <div className='flex h-full items-center justify-center bg-transparent'>
        <LoadingStatePanel
          icon={<AlertTriangle className='h-10 w-10' />}
          tone='red'
          title={error}
          message='请检查网络连接或稍后重试。'
        >
          <div className='flex items-center justify-center gap-3'>
            <button
              onClick={onBack}
              className='inline-flex transform items-center gap-1.5 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 px-3.5 py-2 text-sm font-medium text-white shadow-lg transition-all duration-200 hover:scale-105 hover:from-green-600 hover:to-emerald-700 hover:shadow-xl'
            >
              <ArrowLeft className='h-4 w-4' />
              返回前页
            </button>

            <button
              onClick={onRetry}
              className='inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors duration-200 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            >
              <RefreshCw className='h-4 w-4' />
              重新尝试
            </button>
          </div>
        </LoadingStatePanel>
      </div>
    </PageLayout>
  );
}
