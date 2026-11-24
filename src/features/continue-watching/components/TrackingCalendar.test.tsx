import { act, render, screen } from '@testing-library/react';

import { fetchTrackingCalendar } from '@/features/continue-watching/lib/tracking-calendar-client';

import { TrackingCalendar, TrackingCalendarSkeleton } from './TrackingCalendar';

jest.mock('@/features/continue-watching/lib/tracking-calendar-client', () => ({
  fetchTrackingCalendar: jest.fn(),
}));
jest.mock('@/components/card-actions/useMediaCardMenu', () => ({
  useMediaCardMenu: () => ({}),
}));

it('周历未知条数显示加载状态，不编造每日条目', () => {
  const { container } = render(<TrackingCalendarSkeleton />);
  expect(
    screen
      .getByRole('status', { name: '加载追剧周历' })
      .querySelector('.ice-spinner'),
  ).not.toBeNull();
  expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(0);
});

it('周历请求完成后以实际数据决定空状态', async () => {
  let resolve!: (value: []) => void;
  jest.mocked(fetchTrackingCalendar).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<TrackingCalendar />);
  expect(screen.queryByText('还没有在追的剧')).toBeNull();
  expect(
    screen.getByRole('status', { name: '加载追剧周历' }),
  ).toBeInTheDocument();
  await act(async () => resolve([]));
  expect(screen.getByText('还没有在追的剧')).toBeInTheDocument();
});
