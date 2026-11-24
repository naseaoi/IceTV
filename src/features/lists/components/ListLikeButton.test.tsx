import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { setListLiked } from '@/features/lists/lib/lists-client';
import type { ListLikeState } from '@/features/lists/types';
import { showToast } from '@/lib/toast';
import { DisplayableError } from '@/lib/user-facing-error';

import { ListLikeButton } from './ListLikeButton';

jest.mock('@/features/lists/lib/lists-client', () => ({
  setListLiked: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

function Button({ authenticated = true, isOwner = false }) {
  const [state, setState] = useState<ListLikeState>({
    liked: false,
    likeCount: 2,
  });
  return (
    <ListLikeButton
      listId='list'
      state={state}
      isOwner={isOwner}
      authenticated={authenticated}
      onChange={setState}
    />
  );
}

beforeEach(() => jest.clearAllMocks());

it('收藏与取消收藏同步切换文案和按下态，在途请求保持文案占位并防止重复提交', async () => {
  let resolve!: (value: ListLikeState) => void;
  jest.mocked(setListLiked).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<Button />);
  const button = screen.getByRole('button', { name: '收藏' });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText('已收藏')).toHaveAttribute('aria-hidden', 'true');
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: '已收藏' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByText('收藏')).toHaveAttribute('aria-hidden', 'true');
  fireEvent.click(button);
  expect(setListLiked).toHaveBeenCalledTimes(1);
  expect(setListLiked).toHaveBeenLastCalledWith('list', true);
  await act(async () => resolve({ liked: true, likeCount: 3 }));
  jest.mocked(setListLiked).mockResolvedValue({ liked: false, likeCount: 2 });
  await act(async () => fireEvent.click(button));
  expect(setListLiked).toHaveBeenLastCalledWith('list', false);
  expect(screen.getByRole('button', { name: '收藏' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

it('提交失败恢复收藏文案并提示错误', async () => {
  jest.mocked(setListLiked).mockRejectedValue(new DisplayableError('收藏失败'));
  render(<Button />);
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: '收藏' })),
  );
  expect(screen.getByRole('button', { name: '收藏' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect(showToast).toHaveBeenCalledWith('收藏失败', 'error');
});

it('游客点击提示登录后可收藏', () => {
  render(<Button authenticated={false} />);
  fireEvent.click(screen.getByRole('button', { name: '收藏' }));
  expect(showToast).toHaveBeenCalledWith('登录后可收藏', 'info');
  expect(setListLiked).not.toHaveBeenCalled();
});

it('作者隐藏收藏入口', () => {
  render(<Button isOwner />);
  expect(screen.queryByRole('button')).toBeNull();
});
