import { act, render, screen } from '@testing-library/react';

import { POSTER_GRID_CLASS } from '@/components/poster-grid-layout';
import { FavoriteGrid } from '@/features/favorites/components/FavoriteGrid';
import type { FavoriteItem } from '@/features/favorites/types';

jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({
    id,
    myRating,
    from,
    query,
  }: {
    id: string;
    myRating?: number;
    from: string;
    query?: string;
  }) => (
    <div data-testid={`card-${id}`} data-from={from} data-query={query}>
      {myRating}
    </div>
  ),
}));

const items: FavoriteItem[] = Array.from({ length: 1000 }, (_, index) => ({
  id: String(index),
  source: 'source',
  title: `Favorite ${index}`,
  poster: '',
  episodes: 12,
  source_name: 'Source',
  search_title: `Search ${index}`,
  myRating: 8.6,
}));

describe('FavoriteGrid', () => {
  const originalResizeObserver = global.ResizeObserver;
  let frames: Map<number, FrameRequestCallback>;

  const flushFrames = () => {
    act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  };

  beforeEach(() => {
    frames = new Map();
    let frameId = 0;
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.set(++frameId, callback);
        return frameId;
      });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(
        () =>
          ({
            width: 900,
            top: 200 - document.body.scrollTop,
          }) as DOMRect,
      );
  });

  afterEach(() => {
    document.body.scrollTop = 0;
    global.ResizeObserver = originalResizeObserver;
    jest.restoreAllMocks();
  });

  it('keeps the ordinary poster grid and passes through rating and playback props', () => {
    const { container } = render(<FavoriteGrid items={items.slice(0, 3)} />);

    expect(container.firstChild).toHaveClass(POSTER_GRID_CLASS);
    expect(screen.getAllByTestId(/^card-/)).toHaveLength(3);
    expect(screen.getByTestId('card-0')).toHaveTextContent('8.6');
    expect(screen.getByTestId('card-0')).toHaveAttribute(
      'data-from',
      'favorite',
    );
    expect(screen.getByTestId('card-0')).toHaveAttribute(
      'data-query',
      'Search 0',
    );
  });

  it('recycles a large library on body scroll and renders the last row', () => {
    const { container } = render(<FavoriteGrid items={items} virtualized />);
    expect(container.firstChild).toHaveClass(POSTER_GRID_CLASS);
    expect(screen.getAllByTestId(/^card-/)).toHaveLength(48);
    flushFrames();

    expect(screen.getByTestId('card-0')).toHaveTextContent('8.6');
    expect(screen.getAllByTestId(/^card-/).length).toBeLessThan(48);
    const spacer = container.firstElementChild
      ?.firstElementChild as HTMLElement;
    const height = Number.parseFloat(spacer.style.height);
    expect(height).toBeGreaterThan(50000);

    act(() => {
      document.body.scrollTop = 200 + height - window.innerHeight;
      document.body.dispatchEvent(new Event('scroll'));
    });
    flushFrames();

    expect(screen.queryByTestId('card-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('card-999')).toHaveTextContent('8.6');
    expect(screen.getAllByTestId(/^card-/).length).toBeLessThan(48);

    act(() => {
      document.body.scrollTop = 0;
      document.body.dispatchEvent(new Event('scroll'));
    });
    flushFrames();
    expect(screen.getByTestId('card-0')).toBeInTheDocument();
    expect(screen.queryByTestId('card-999')).not.toBeInTheDocument();
  });
});
