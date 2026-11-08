import { render, screen } from '@testing-library/react';

import RatingStars from '@/components/RatingStars';

describe('RatingStars', () => {
  it.each([1, 5, 8.6, 9, 10])(
    'renders %s points as five proportionally filled stars',
    (value) => {
      const { container } = render(<RatingStars value={value} />);
      expect(
        screen.getByRole('img', {
          name: `${value.toFixed(1)} 分（满分 10 分）`,
        }),
      ).toBeInTheDocument();
      const fills = container.querySelectorAll<HTMLElement>('[style]');
      expect(fills).toHaveLength(5);
      expect(Array.from(fills).map((fill) => fill.style.width)).toEqual(
        Array.from(
          { length: 5 },
          (_, index) => `${Math.max(0, Math.min(1, value / 2 - index)) * 100}%`,
        ),
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    },
  );

  it('renders unrated content and forwards className', () => {
    render(<RatingStars value={null} className='custom-rating' />);
    expect(screen.getByText('未评分')).toHaveClass('custom-rating');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('supports small stars', () => {
    const { container } = render(<RatingStars value={6} size='sm' />);
    expect(container.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5');
  });

  it('pops newly lit stars in order and marks the landing star', () => {
    const { container } = render(
      <RatingStars value={8} decorative pop={{ id: 1, from: 1, to: 4 }} />,
    );
    const stars = Array.from(container.firstElementChild?.children ?? []);
    expect(
      stars.map((star) => star.classList.contains('rating-star-pop')),
    ).toEqual([false, true, true, true, false]);
    expect(stars[3]).toHaveAttribute('data-last');
    expect(
      (stars[2] as HTMLElement).style.getPropertyValue('--star-index'),
    ).toBe('1');
  });

  it('dips the stars that go dark when the rating drops', () => {
    const { container } = render(
      <RatingStars value={2} decorative pop={{ id: 1, from: 4, to: 1 }} />,
    );
    const stars = Array.from(container.firstElementChild?.children ?? []);
    expect(
      stars.map((star) => star.classList.contains('rating-star-dip')),
    ).toEqual([false, true, true, true, false]);
  });
});
