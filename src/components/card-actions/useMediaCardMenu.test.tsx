import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { CardAction } from '@/components/card-actions/actions';
import {
  type MediaCardMenuTarget,
  useMediaCardMenu,
} from '@/components/card-actions/useMediaCardMenu';

const push = jest.fn();
const showActionSheet = jest.fn();
const openListPicker = jest.fn();
const openWatchRecord = jest.fn();
let favoriteKeys = new Set<string>();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, prefetch: jest.fn() }),
}));
jest.mock('@/components/CardInteractionProvider', () => ({
  useCardInteractionManager: () => ({
    showActionSheet,
    hideActionSheet: jest.fn(),
    showConfirm: jest.fn(),
    ensureFavoritesLoaded: jest.fn().mockResolvedValue(undefined),
    getFavoriteStatus: (key: string) => favoriteKeys.has(key),
  }),
}));
jest.mock('@/components/list-picker-context', () => ({
  useOpenListPicker: () => openListPicker,
}));
jest.mock('@/components/watch-record-context', () => ({
  useOpenWatchRecord: () => openWatchRecord,
}));
jest.mock('@/lib/db.client', () => ({
  deleteFavorite: jest.fn(),
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  saveFavorite: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

function Card({ target }: { target: MediaCardMenuTarget }) {
  const menuProps = useMediaCardMenu({ target, href: '/play?x=1' });
  return (
    <a href='/play?x=1' {...menuProps}>
      {target.title}
    </a>
  );
}

async function openMenu(target: MediaCardMenuTarget) {
  render(<Card target={target} />);
  fireEvent.contextMenu(screen.getByText(target.title), {
    clientX: 12,
    clientY: 34,
  });
  await waitFor(() => expect(showActionSheet).toHaveBeenCalled());
  const payload = showActionSheet.mock.calls[0][1] as {
    actions: CardAction[];
    anchorRect: unknown;
  };
  return payload;
}

beforeEach(() => {
  jest.clearAllMocks();
  favoriteKeys = new Set();
});

test('右键在光标处展开播放外的作品操作，并反映当前收藏状态', async () => {
  favoriteKeys = new Set(['src1+42']);
  const payload = await openMenu({
    source: 'src1',
    id: '42',
    title: '三体',
    year: '2023',
    cover: 'c.jpg',
  });

  expect(payload.anchorRect).toEqual({
    top: 34,
    left: 12,
    width: 0,
    height: 0,
  });
  expect(payload.actions.map((action) => action.label)).toEqual([
    '立即播放',
    '取消收藏',
    '加入片单',
    '标记评分',
  ]);

  payload.actions[2].onClick();
  expect(openListPicker).toHaveBeenCalledWith(
    expect.objectContaining({ source: 'src1', id: '42', title: '三体' }),
  );
  payload.actions[0].onClick();
  expect(push).toHaveBeenCalledWith('/play?x=1');
});

test('目录作品把收藏交给标记评分面板，无法定位的作品只保留播放', async () => {
  const catalog = await openMenu({
    source: 'douban',
    id: '7',
    title: '流浪地球',
    cover: '',
  });
  expect(catalog.actions.map((action) => action.id)).toEqual([
    'play',
    'add-to-list',
    'watch-record',
  ]);

  showActionSheet.mockClear();
  const unknown = await openMenu({ title: '无源作品', cover: '' });
  expect(unknown.actions.map((action) => action.id)).toEqual(['play']);
});
