import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import {
  fetchMessageSettings,
  saveMessageSettings,
} from '@/lib/messages.client';

import MessageSettings from './MessageSettings';

jest.mock('@/lib/messages.client', () => ({
  fetchMessageSettings: jest.fn(),
  saveMessageSettings: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchMessageSettings).mockResolvedValue({ mutedKinds: [] });
});

it('保存与回读均失败时恢复最后确认值并展示就地错误', async () => {
  jest
    .mocked(saveMessageSettings)
    .mockResolvedValueOnce({ mutedKinds: ['review-reply'] })
    .mockRejectedValueOnce(new Error('internal'));
  const onSaved = jest.fn();
  render(<MessageSettings onSaved={onSaved} />);
  const reply = screen.getByRole('switch', { name: '评价回复' });
  await waitFor(() => expect(reply).toBeEnabled());
  fireEvent.click(reply);
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  jest.mocked(fetchMessageSettings).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(reply);
  await screen.findByRole('alert');
  expect(reply).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('alert')).not.toHaveTextContent('internal');
});

it('失败后的旧回读不会覆盖之后已保存的新操作', async () => {
  const reread = deferred<{ mutedKinds: [] }>();
  jest
    .mocked(fetchMessageSettings)
    .mockResolvedValueOnce({ mutedKinds: [] })
    .mockReturnValueOnce(reread.promise);
  jest
    .mocked(saveMessageSettings)
    .mockRejectedValueOnce(new Error('failed'))
    .mockResolvedValueOnce({ mutedKinds: ['review-reply'] });
  render(<MessageSettings onSaved={jest.fn()} />);
  const reply = screen.getByRole('switch', { name: '评价回复' });
  await waitFor(() => expect(reply).toBeEnabled());
  fireEvent.click(reply);
  await screen.findByRole('alert');
  expect(reply).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(reply);
  await waitFor(() => expect(saveMessageSettings).toHaveBeenCalledTimes(2));
  await act(async () => reread.resolve({ mutedKinds: [] }));
  expect(reply).toHaveAttribute('aria-checked', 'false');
});

it('连续提交中前一次成功仍更新最后确认值', async () => {
  const first = deferred<{ mutedKinds: ['review-reply'] }>();
  jest
    .mocked(saveMessageSettings)
    .mockReturnValueOnce(first.promise)
    .mockRejectedValueOnce(new Error('failed'));
  render(<MessageSettings onSaved={jest.fn()} />);
  const reply = screen.getByRole('switch', { name: '评价回复' });
  await waitFor(() => expect(reply).toBeEnabled());
  fireEvent.click(reply);
  fireEvent.click(reply);
  jest.mocked(fetchMessageSettings).mockRejectedValueOnce(new Error('offline'));
  await act(async () => first.resolve({ mutedKinds: ['review-reply'] }));
  await screen.findByRole('alert');
  expect(reply).toHaveAttribute('aria-checked', 'false');
});
