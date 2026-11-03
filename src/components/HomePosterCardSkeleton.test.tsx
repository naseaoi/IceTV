import { render } from '@testing-library/react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';

describe('HomePosterCardSkeleton', () => {
  it('reserves the same title line box as VideoCardTitle', () => {
    const { container } = render(<HomePosterCardSkeleton />);
    const titleBox =
      container.firstElementChild?.firstElementChild?.children[1];

    expect(titleBox).toHaveClass('mt-2', 'h-[1.5em]', 'text-[13px]');
    expect(container.querySelectorAll('.skeleton')).toHaveLength(2);
    expect(container.querySelector('.skeleton .skeleton')).toBeNull();
  });

  it('preserves the fixed title height used by recommendation posters', () => {
    const { container } = render(<HomePosterCardSkeleton variant='poster' />);
    expect(
      container.firstElementChild?.firstElementChild?.children[1],
    ).toHaveClass('h-5');
  });

  it('reserves a second 16px line and 2px margin for history and top works', () => {
    const { container } = render(
      <HomePosterCardSkeleton className='w-full' subtitle />,
    );
    const card = container.firstElementChild;
    const subtitleBox = card?.firstElementChild?.children[2];

    expect(card).toHaveClass('w-full');
    expect(subtitleBox).toHaveClass('mt-0.5', 'h-4');
    expect(container.querySelectorAll('.skeleton')).toHaveLength(3);
    expect(container.querySelector('.skeleton .skeleton')).toBeNull();
  });
});
