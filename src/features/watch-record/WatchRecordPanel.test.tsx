import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WatchRecordPanel } from '@/features/watch-record/WatchRecordPanel';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

const mockGetFavoriteForWork = jest.fn();
const mockBatch = jest.fn();
const mockSaveFavorite = jest.fn();
const mockDeleteFavorite = jest.fn();
const mockFetchReview = jest.fn();
const mockSaveReview = jest.fn();
const mockDeleteReview = jest.fn();

jest.mock('@/lib/db.client', () => ({
  batchFavorites: (...args: unknown[]) => mockBatch(...args),
  deleteFavorite: (...args: unknown[]) => mockDeleteFavorite(...args),
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  getFavoriteForWork: (...args: unknown[]) => mockGetFavoriteForWork(...args),
  saveFavorite: (...args: unknown[]) => mockSaveFavorite(...args),
}));
jest.mock('@/lib/video-reviews.client', () => ({
  deleteVideoReview: (...args: unknown[]) => mockDeleteReview(...args),
  fetchMyVideoReview: (...args: unknown[]) => mockFetchReview(...args),
  saveVideoReview: (...args: unknown[]) => mockSaveReview(...args),
}));

const target = {
  source: 'src',
  id: '1',
  title: '作品',
  year: '2024',
  cover: 'cover.jpg',
  sourceName: '源站',
};

const entry = {
  key: 'src+1',
  watchStatus: 'watching',
  watchStatusManual: false,
  watchedAt: null,
  myRating: null,
};

function renderPanel() {
  const onClose = jest.fn();
  render(<WatchRecordPanel target={target} open onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFavoriteForWork.mockResolvedValue(entry);
  mockFetchReview.mockResolvedValue(null);
  mockBatch.mockResolvedValue({ affected: 1 });
  mockSaveFavorite.mockResolvedValue('src+1');
  mockSaveReview.mockResolvedValue({});
});

it('数据就绪前显示骨架，就绪后才渲染表单', async () => {
  let resolveReview: (value: unknown) => void = () => undefined;
  mockFetchReview.mockReturnValue(
    new Promise((resolve) => {
      resolveReview = resolve;
    }),
  );
  renderPanel();
  expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument();
  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();

  resolveReview({ rating: 8, content: '不错', is_public: true });
  expect(await screen.findByRole('slider', { name: '评分' })).toHaveAttribute(
    'aria-valuenow',
    '8',
  );
  expect(screen.getByLabelText('短评')).toHaveValue('不错');
  expect(screen.getByRole('radio', { name: '在看' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

it('未改动时不可保存，改状态后按片单键提交', async () => {
  const onClose = renderPanel();
  const save = await screen.findByRole('button', { name: '保存' });
  await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeTruthy());
  expect(save).toBeDisabled();

  fireEvent.click(screen.getByRole('radio', { name: '想看' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(mockBatch).toHaveBeenCalledWith({
      action: 'set-status',
      target: { keys: ['src+1'] },
      watchStatus: 'planned',
    }),
  );
  expect(mockSaveReview).not.toHaveBeenCalled();
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(showToast).toHaveBeenCalledWith('观看记录已保存', 'success');
});

it('未在片单的作品只写评分时一并加入片单', async () => {
  mockGetFavoriteForWork.mockResolvedValue(null);
  renderPanel();
  const slider = await screen.findByRole('slider', { name: '评分' });
  expect(
    screen.queryByRole('button', { name: '移出片单' }),
  ).not.toBeInTheDocument();

  fireEvent.keyDown(slider, { key: 'End' });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(mockSaveReview).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '作品',
        year: '2024',
        rating: 10,
        content: '',
        source_key: 'src+1',
      }),
    ),
  );
  expect(mockBatch).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(mockSaveFavorite).toHaveBeenCalledWith(
      'src',
      '1',
      expect.not.objectContaining({ watch_status: expect.anything() }),
    ),
  );
});

it('清空已有评价后保存会删除评价', async () => {
  mockFetchReview.mockResolvedValue({
    title: '作品',
    year: '2024',
    title_norm: '作品',
    rating: 7,
    content: '',
    is_public: false,
  });
  renderPanel();
  await screen.findByRole('slider', { name: '评分' });
  fireEvent.click(screen.getByRole('button', { name: '清除' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() =>
    expect(mockDeleteReview).toHaveBeenCalledWith('作品', '2024', '作品'),
  );
  expect(mockSaveReview).not.toHaveBeenCalled();
});

it('保存失败时保留面板并提示', async () => {
  mockBatch.mockRejectedValueOnce(new Error('boom'));
  const onClose = renderPanel();
  fireEvent.click(await screen.findByRole('radio', { name: '看过' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(await screen.findByText('保存失败，请重试')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
  expect(showToast).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
});
