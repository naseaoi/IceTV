import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clapperboard,
  RefreshCw,
  Search,
  Zap,
} from 'lucide-react';
import { ReactNode } from 'react';

import LoadingStatePanel from '@/components/LoadingStatePanel';
import PageLayout from '@/components/PageLayout';

type LoadingStage = 'searching' | 'preferring' | 'fetching' | 'ready';

interface PlayLoadingViewProps {
  loadingStage: LoadingStage;
  loadingMessage: string;
}

interface PlayErrorViewProps {
  error: string;
  videoTitle: string;
  onBack: () => void;
  onRetry: () => void;
}

function getLoadingStageIcon(loadingStage: LoadingStage): ReactNode {
  if (loadingStage === 'searching') {
    return <Search className='w-10 h-10' />;
  }
  if (loadingStage === 'preferring') {
    return <Zap className='w-10 h-10' />;
  }
  if (loadingStage === 'fetching') {
    return <Clapperboard className='w-10 h-10' />;
  }
  return <CheckCircle2 className='w-10 h-10' />;
}

export function PlayLoadingView({
  loadingStage,
  loadingMessage,
}: PlayLoadingViewProps) {
  const loadingStageOrder: LoadingStage[] = [
    'searching',
    'preferring',
    'fetching',
    'ready',
  ];
  const loadingStageIndex = loadingStageOrder.indexOf(loadingStage);
  const loadingProgress =
    ((loadingStageIndex + 1) / loadingStageOrder.length) * 100;

  return (
    <PageLayout activePath='/play'>
      <div className='flex items-center justify-center min-h-screen bg-transparent'>
        <LoadingStatePanel
          icon={getLoadingStageIcon(loadingStage)}
          tone='emerald'
          title='正在准备播放'
          message={loadingMessage}
          description='正在连接播放源并同步剧集信息，请稍候。'
          progress={loadingProgress}
          steps={[
            {
              label: '搜索',
              status:
                loadingStage === 'searching'
                  ? 'active'
                  : loadingStageIndex > 0
                    ? 'done'
                    : 'pending',
            },
            {
              label: '优选',
              status:
                loadingStage === 'preferring'
                  ? 'active'
                  : loadingStageIndex > 1
                    ? 'done'
                    : 'pending',
            },
            {
              label: '详情',
              status:
                loadingStage === 'fetching'
                  ? 'active'
                  : loadingStageIndex > 2
                    ? 'done'
                    : 'pending',
            },
            {
              label: '完成',
              status: loadingStage === 'ready' ? 'active' : 'pending',
            },
          ]}
        />
      </div>
    </PageLayout>
  );
}

export function PlayErrorView({
  error,
  videoTitle,
  onBack,
  onRetry,
}: PlayErrorViewProps) {
  return (
    <PageLayout activePath='/play'>
      <div className='flex items-center justify-center min-h-screen bg-transparent'>
        <LoadingStatePanel
          icon={<AlertTriangle className='w-10 h-10' />}
          tone='red'
          title='哎呀，出现了一些问题'
          message={error}
          description='请检查网络连接或稍后重试。'
        >
          <button
            onClick={onBack}
            className='w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl flex items-center justify-center gap-2'
          >
            {videoTitle ? (
              <>
                <Search className='w-4 h-4' />
                返回搜索
              </>
            ) : (
              <>
                <ArrowLeft className='w-4 h-4' />
                返回上页
              </>
            )}
          </button>

          <button
            onClick={onRetry}
            className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200 flex items-center justify-center gap-2'
          >
            <RefreshCw className='w-4 h-4' />
            重新尝试
          </button>
        </LoadingStatePanel>
      </div>
    </PageLayout>
  );
}
