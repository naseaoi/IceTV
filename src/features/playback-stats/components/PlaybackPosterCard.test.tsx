import { act, fireEvent, render, screen } from '@testing-library/react';

import type { CardAction } from '@/components/card-actions/actions';
import { PlaybackPosterCard } from '@/features/playback-stats/components/PlaybackPosterCard';
import { deleteFavorite, saveFavorite } from '@/lib/db.client';
import { showToast } from '@/lib/toast';

const mockShowActions = jest.fn();
const mockShowConfirm = jest.fn();
let mockFavorited = false;
jest.mock('@/components/CardInteractionProvider', () => ({
  useCardInteractionManager: () => ({
    showActionSheet: mockShowActions,
    hideActionSheet: jest.fn(),
    showConfirm: mockShowConfirm,
    ensureFavoritesLoaded: async () => {},
    getFavoriteStatus: () => mockFavorited,
  }),
  useFavoriteStatus: () => mockFavorited,
}));
jest.mock('@/components/watch-record-context', () => ({
  useOpenWatchRecord: () => null,
}));
jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/hooks/useLongPress', () => ({ useLongPress: () => ({}) }));
jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  saveFavorite: jest.fn(),
  getCachedPlayRecordsSnapshot: () => null,
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

it.each([false, true])(
  '菜单收藏操作完成后给触屏结果提示，原收藏=%s',
  async (favorited) => {
    jest.clearAllMocks();
    mockFavorited = favorited;
    render(
      <PlaybackPosterCard
        title='作品'
        cover=''
        source='src'
        videoId='1'
        subtitle=''
        ariaLabel='播放作品'
        onPlay={jest.fn()}
      />,
    );
    await act(async () =>
      fireEvent.contextMenu(screen.getByRole('button', { name: '播放作品' })),
    );
    const actions: CardAction[] = mockShowActions.mock.calls[0][1].actions;
    await act(async () =>
      actions.find((action) => action.id === 'favorite')!.onClick(),
    );
    if (favorited) {
      expect(showToast).not.toHaveBeenCalled();
      await act(async () => mockShowConfirm.mock.calls[0][1].onConfirm());
      expect(deleteFavorite).toHaveBeenCalledWith('src', '1');
    } else expect(saveFavorite).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      favorited ? '已取消收藏' : '已加入收藏',
      'success',
    );
  },
);
