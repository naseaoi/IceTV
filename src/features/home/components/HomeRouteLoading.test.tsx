import { act, render, screen } from '@testing-library/react';
import { type PropsWithChildren } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import HomeRouteLoading from '@/features/home/components/HomeRouteLoading';
import type { HomeClientSnapshot } from '@/features/home/lib/home-client-cache';

const mockGetHomeClientSnapshot = jest.fn();
const mockSkeletonRender = jest.fn();

jest.mock('@/features/home/lib/home-client-cache', () => ({
  getHomeClientSnapshot: () => mockGetHomeClientSnapshot(),
}));
jest.mock('@/features/home/components/HomeClient', () => ({
  __esModule: true,
  default: ({ initialData }: HomeClientSnapshot) => (
    <div data-testid='cached-home'>{initialData.hotMovies[0]?.title}</div>
  ),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: PropsWithChildren) => {
    mockSkeletonRender();
    return <div data-testid='home-skeleton'>{children}</div>;
  },
}));
jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
jest.mock('@/components/ContinueWatchingCardSkeleton', () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock('@/components/HomePosterCardSkeleton', () => ({
  __esModule: true,
  default: () => <div />,
}));

const snapshot: HomeClientSnapshot = {
  initialData: {
    hotMovies: [
      {
        id: 'cached',
        title: 'Cached movie',
        poster: '/poster.jpg',
        rate: '8.0',
        year: '2026',
      },
    ],
    hotTvShows: [],
    hotVarietyShows: [],
    bangumiCalendarData: [],
  },
  continueWatchingSkeletonCount: 3,
  updatedAt: Date.now(),
};

describe('HomeRouteLoading', () => {
  beforeEach(() => {
    mockGetHomeClientSnapshot.mockReturnValue(null);
    mockSkeletonRender.mockClear();
  });

  it('renders the cached home immediately without first mounting skeletons', () => {
    mockGetHomeClientSnapshot.mockReturnValue(snapshot);

    render(<HomeRouteLoading continueWatchingCount={3} />);

    expect(screen.getByTestId('cached-home')).toHaveTextContent('Cached movie');
    expect(mockSkeletonRender).not.toHaveBeenCalled();
  });

  it('keeps the skeleton when no usable snapshot exists', () => {
    render(<HomeRouteLoading continueWatchingCount={3} />);

    expect(screen.getByTestId('home-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('cached-home')).not.toBeInTheDocument();
  });

  it('preserves server markup during hydration before restoring the browser snapshot', async () => {
    mockGetHomeClientSnapshot.mockReturnValue(snapshot);
    const serverHtml = renderToString(
      <HomeRouteLoading continueWatchingCount={3} />,
    );
    expect(serverHtml).toContain('home-skeleton');
    expect(serverHtml).not.toContain('Cached movie');
    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    const errors: unknown[] = [];
    const root = hydrateRoot(
      container,
      <HomeRouteLoading continueWatchingCount={3} />,
      { onRecoverableError: (error) => errors.push(error) },
    );

    try {
      await act(async () => {
        await Promise.resolve();
      });

      expect(errors).toEqual([]);
      expect(container.textContent).toBe('Cached movie');
    } finally {
      await act(async () => root.unmount());
    }
  });
});
