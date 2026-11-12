import { AlertCircle } from 'lucide-react';

import LoadingStatePanel from '@/components/LoadingStatePanel';

export default function LoadErrorState({
  message = '加载失败',
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <div role='alert' className='flex justify-center py-8'>
      <LoadingStatePanel icon={<AlertCircle />} tone='red' message={message}>
        <button
          type='button'
          onClick={onRetry}
          className='rounded-lg px-4 py-2 text-sm text-brand-600 hover:bg-brand-500/10 dark:text-brand-400'
        >
          重试
        </button>
      </LoadingStatePanel>
    </div>
  );
}
