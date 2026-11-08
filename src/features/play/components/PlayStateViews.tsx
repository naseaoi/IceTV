'use client';

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  RefreshCw,
  Search,
  Zap,
} from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';

import LoadingStatePanel from '@/components/LoadingStatePanel';
import {
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
} from '@/components/modals/modal-styles';
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
    return <Search />;
  }
  if (loadingStage === 'preferring') {
    return <Zap />;
  }
  if (loadingStage === 'fetching') {
    return <Clapperboard />;
  }
  return <CheckCircle2 />;
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
        <LoadingStatePanel
          icon={getLoadingStageIcon(loadingStage)}
          iconKey={loadingStage}
          loading={loadingStage !== 'ready'}
          message={loadingMessage}
          progress={loadingProgress}
        >
          <button
            type='button'
            onClick={onBack}
            aria-label='取消加载'
            disabled={!onBack}
            aria-hidden={!onBack}
            tabIndex={onBack ? 0 : -1}
            className={`${MODAL_SECONDARY_BUTTON_CLASS} ${
              onBack ? '' : 'invisible'
            }`}
          >
            取消
          </button>
        </LoadingStatePanel>
      </div>
    </PageLayout>
  );
}

export function PlayErrorView({ error, onBack, onRetry }: PlayErrorViewProps) {
  const message =
    error === '缺少必要参数'
      ? '缺少播放目标参数，请从搜索结果、收藏或历史记录重新进入。'
      : '请检查网络连接或稍后重试。';

  return (
    <PageLayout activePath='/play'>
      <div className='flex h-full items-center justify-center'>
        <LoadingStatePanel
          icon={<AlertTriangle />}
          tone='red'
          title={error}
          message={message}
        >
          <div className='flex items-center justify-center gap-3'>
            <button
              type='button'
              onClick={onBack}
              className={`gap-1.5 ${MODAL_SECONDARY_BUTTON_CLASS}`}
            >
              <ArrowLeft className='h-4 w-4' />
              返回前页
            </button>
            <button
              type='button'
              onClick={onRetry}
              className={`gap-1.5 ${MODAL_PRIMARY_BUTTON_CLASS}`}
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
