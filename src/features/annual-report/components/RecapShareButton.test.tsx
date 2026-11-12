import { act, fireEvent, render, screen } from '@testing-library/react';

import { RecapShareButton } from '@/features/annual-report/components/RecapShareButton';
import {
  fetchRecapShareState,
  publishRecap,
} from '@/features/annual-report/lib/client';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: { status: 'authenticated', profileId: 'user' },
  }),
}));
jest.mock('@/features/annual-report/lib/client', () => ({
  AnnualReportError: class extends Error {},
  fetchRecapShareState: jest.fn(),
  publishRecap: jest.fn(),
  unpublishRecap: jest.fn(),
}));
it('保存期间两个开关保持可见并禁用，完成后恢复', async () => {
  jest
    .mocked(fetchRecapShareState)
    .mockResolvedValue({ published: false, hideRhythm: false } as Awaited<
      ReturnType<typeof fetchRecapShareState>
    >);
  let resolve!: (value: Awaited<ReturnType<typeof publishRecap>>) => void;
  jest.mocked(publishRecap).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<RecapShareButton year={2025} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '分享' }));
  });
  fireEvent.click(screen.getByRole('switch', { name: '公开到个人主页' }));
  for (const toggle of screen.getAllByRole('switch'))
    expect(toggle).toBeDisabled();
  expect(
    screen.getByRole('switch', { name: '公开到个人主页' }),
  ).toHaveAttribute('aria-checked', 'true');
  await act(async () => {
    resolve({ published: true, hideRhythm: false } as Awaited<
      ReturnType<typeof publishRecap>
    >);
  });
  for (const toggle of screen.getAllByRole('switch'))
    expect(toggle).toBeEnabled();
});
