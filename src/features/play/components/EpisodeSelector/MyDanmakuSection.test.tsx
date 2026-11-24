import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { MyDanmakuSection } from './MyDanmakuSection';

const mockFetch = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: { status: 'authenticated', profileId: 'me' },
  }),
}));
jest.mock('@/features/play/lib/danmaku/episode-storage', () => ({
  getPersistedEpisodeId: jest.fn().mockResolvedValue(123),
}));
jest.mock('@/features/play/lib/danmaku/user-client', () => ({
  fetchMyUserDanmaku: (...args: unknown[]) => mockFetch(...args),
  deleteUserDanmaku: (...args: unknown[]) => mockDelete(...args),
  USER_DANMAKU_SENT_EVENT: 'test-danmaku-sent',
}));
const item = (id: string) => ({
  id,
  text: `本人弹幕${id}`,
  time: 10,
  color: '#ffffff',
  mode: 0,
  mine: true,
});
const props = {
  source: 'source',
  videoId: 'video',
  episodeIndex: 0,
  scopeKey: 'source:video:0',
  refreshToken: 0,
};
beforeEach(() => {
  mockFetch.mockReset();
  mockDelete.mockReset().mockResolvedValue(undefined);
});

it('独立查询本人弹幕、分页、删除并响应发送事件', async () => {
  mockFetch
    .mockResolvedValueOnce({ items: [item('old')], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [item('older')], nextCursor: null });
  const onDeleted = jest.fn();
  render(<MyDanmakuSection {...props} onDeleted={onDeleted} />);
  expect(await screen.findByText('本人弹幕old')).toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledWith(
    'dandan:123',
    undefined,
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
  expect(await screen.findByText('本人弹幕older')).toBeInTheDocument();
  expect(mockFetch).toHaveBeenLastCalledWith(
    'dandan:123',
    'next',
    expect.any(AbortSignal),
  );
  fireEvent.click(
    screen.getByRole('button', { name: '删除弹幕：本人弹幕old' }),
  );
  await waitFor(() =>
    expect(screen.queryByText('本人弹幕old')).not.toBeInTheDocument(),
  );
  expect(mockDelete).toHaveBeenCalledWith('old');
  expect(onDeleted).toHaveBeenCalledTimes(1);
  mockFetch.mockResolvedValueOnce({ items: [item('new')], nextCursor: null });
  act(() =>
    window.dispatchEvent(
      new CustomEvent('test-danmaku-sent', { detail: 'dandan:123' }),
    ),
  );
  expect(await screen.findByText('本人弹幕new')).toBeInTheDocument();
});

it('首页失败可重试，换集隔离迟到响应', async () => {
  mockFetch
    .mockRejectedValueOnce(new Error('failed'))
    .mockResolvedValueOnce({ items: [item('a')], nextCursor: null });
  const { rerender } = render(<MyDanmakuSection {...props} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('弹幕加载失败');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('本人弹幕a')).toBeInTheDocument();
  let finish!: (value: unknown) => void;
  mockFetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  rerender(<MyDanmakuSection {...props} episodeIndex={1} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
  expect(screen.queryByText('本人弹幕a')).not.toBeInTheDocument();
  mockFetch.mockResolvedValueOnce({ items: [item('c')], nextCursor: null });
  rerender(<MyDanmakuSection {...props} episodeIndex={2} />);
  expect(await screen.findByText('本人弹幕c')).toBeInTheDocument();
  await act(async () => finish({ items: [item('late')], nextCursor: null }));
  expect(screen.queryByText('本人弹幕late')).not.toBeInTheDocument();
});
