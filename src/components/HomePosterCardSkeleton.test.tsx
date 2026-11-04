import { render } from '@testing-library/react';

import HomePosterCardSkeleton from '@/components/HomePosterCardSkeleton';
import {
  POSTER_CARD_FIXED_TITLE_ROW_CLASS,
  POSTER_CARD_SUBTITLE_ROW_CLASS,
  POSTER_CARD_TITLE_ROW_CLASS,
} from '@/components/poster-card-layout';
import { SKELETON_TEXT_STRUT } from '@/components/SkeletonText';
import { VideoCardTitle } from '@/components/video-card/VideoCardTitle';

const classes = (value: string) => value.split(' ');

function cardRows(container: HTMLElement) {
  return container.firstElementChild?.firstElementChild?.children;
}

describe('HomePosterCardSkeleton', () => {
  it('标题行与 VideoCardTitle 共用同一几何类，并由文字行高撑开', () => {
    const { container: real } = render(<VideoCardTitle title='测试影片' />);
    const { container } = render(<HomePosterCardSkeleton />);
    const titleRow = cardRows(container)?.[1];

    expect(real.querySelector('[data-video-card-title]')).toHaveClass(
      ...classes(POSTER_CARD_TITLE_ROW_CLASS),
    );
    expect(titleRow).toHaveClass(...classes(POSTER_CARD_TITLE_ROW_CLASS));
    expect(titleRow?.textContent).toBe(SKELETON_TEXT_STRUT);
    expect(container.querySelectorAll('.skeleton')).toHaveLength(2);
    expect(container.querySelector('.skeleton .skeleton')).toBeNull();
  });

  it('poster 变体沿用 PosterCard 的固定标题行', () => {
    const { container } = render(<HomePosterCardSkeleton variant='poster' />);
    expect(cardRows(container)?.[1]).toHaveClass(
      ...classes(POSTER_CARD_FIXED_TITLE_ROW_CLASS),
    );
  });

  it('副标题行与历史、排行卡片共用几何类', () => {
    const { container } = render(
      <HomePosterCardSkeleton className='w-full' subtitle />,
    );

    expect(container.firstElementChild).toHaveClass('w-full');
    expect(cardRows(container)?.[1]).toHaveClass(
      ...classes(POSTER_CARD_TITLE_ROW_CLASS),
    );
    expect(cardRows(container)?.[2]).toHaveClass(
      ...classes(POSTER_CARD_SUBTITLE_ROW_CLASS),
    );
    expect(container.querySelectorAll('.skeleton')).toHaveLength(3);
    expect(container.querySelector('.skeleton .skeleton')).toBeNull();
  });
});
