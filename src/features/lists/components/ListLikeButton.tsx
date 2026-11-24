'use client';

import { Heart } from 'lucide-react';
import { useRef, useState } from 'react';

import { setListLiked } from '@/features/lists/lib/lists-client';
import type { ListLikeState } from '@/features/lists/types';
import { showToast } from '@/lib/toast';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

const BUTTON_CLASS =
  'mr-1 inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors';

// 收藏数在头部统计行显示，这里只负责切换；作者隐藏入口，游客点击提示登录
export function ListLikeButton({
  listId,
  state,
  isOwner,
  authenticated,
  onChange,
}: {
  listId: string;
  state: ListLikeState;
  isOwner: boolean;
  authenticated: boolean;
  onChange: (state: ListLikeState) => void;
}) {
  const [pop, setPop] = useState(0);
  const inFlight = useRef(false);

  if (isOwner) return null;

  async function toggle() {
    if (!authenticated) {
      showToast('登录后可收藏', 'info');
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    const previous = state;
    if (!previous.liked) setPop((value) => value + 1);
    onChange({
      liked: !previous.liked,
      likeCount: Math.max(0, previous.likeCount + (previous.liked ? -1 : 1)),
    });
    try {
      onChange(await setListLiked(listId, !previous.liked));
    } catch (error) {
      onChange(previous);
      if (!isAbortError(error))
        showToast(getErrorMessage(error, '操作失败，请稍后重试'), 'error');
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <button
      type='button'
      aria-pressed={state.liked}
      onClick={() => void toggle()}
      className={`${BUTTON_CLASS} ${
        state.liked
          ? 'bg-brand-500/10 text-brand-600 hover:bg-brand-500/15 dark:bg-brand-400/15 dark:text-brand-300 dark:hover:bg-brand-400/20'
          : 'bg-gray-900/[0.06] text-gray-700 hover:bg-gray-900/[0.1] dark:bg-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.12]'
      }`}
    >
      <Heart
        key={pop}
        aria-hidden='true'
        className={`h-4 w-4 shrink-0 ${state.liked ? 'fill-red-600 stroke-red-600' : ''} ${state.liked && pop > 0 ? 'motion-pop' : ''}`}
      />
      <span className='grid'>
        <span
          aria-hidden={state.liked}
          className={`[grid-area:1/1] ${state.liked ? 'invisible' : ''}`}
        >
          收藏
        </span>
        <span
          aria-hidden={!state.liked}
          className={`[grid-area:1/1] ${state.liked ? '' : 'invisible'}`}
        >
          已收藏
        </span>
      </span>
    </button>
  );
}
