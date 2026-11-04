import { render } from '@testing-library/react';

import {
  CONTINUE_CARD_CLASS,
  CONTINUE_CARD_COVER_CLASS,
  CONTINUE_CARD_TITLE_TEXT_CLASS,
} from '@/components/continue-card/layout';
import ContinueCard from '@/components/ContinueCard';
import ContinueWatchingCardSkeleton from '@/components/ContinueWatchingCardSkeleton';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/components/CardInteractionProvider', () => ({
  useCardInteractionManager: () => ({
    showActionSheet: jest.fn(),
    showConfirm: jest.fn(),
  }),
}));

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

jest.mock('@/hooks/useLongPress', () => ({
  useLongPress: () => ({}),
}));

const classes = (value: string) => value.split(' ');

describe('ContinueWatchingCardSkeleton', () => {
  it('与 ContinueCard 共用卡片、封面与标题行几何类', () => {
    const { container: real } = render(
      <ContinueCard
        source='source-key'
        id='video-id'
        title='测试影片'
        poster='/poster.webp'
        currentEpisode={3}
        totalEpisodes={12}
        progress={50}
        resumeTime={120}
      />,
    );
    const { container: skeleton } = render(<ContinueWatchingCardSkeleton />);

    const realCard = real.querySelector('[data-continue-card]');
    const skeletonCard = skeleton.querySelector('[data-continue-skeleton]');
    expect(realCard).toHaveClass(...classes(CONTINUE_CARD_CLASS));
    expect(skeletonCard).toHaveClass(...classes(CONTINUE_CARD_CLASS));
    expect(realCard?.firstElementChild).toHaveClass(
      ...classes(CONTINUE_CARD_COVER_CLASS),
    );
    expect(skeletonCard?.firstElementChild).toHaveClass(
      'skeleton',
      ...classes(CONTINUE_CARD_COVER_CLASS),
    );
    expect(real.querySelector('p')).toHaveClass(
      ...classes(CONTINUE_CARD_TITLE_TEXT_CLASS),
    );
    expect(skeletonCard?.children[1]?.firstElementChild).toHaveClass(
      ...classes(CONTINUE_CARD_TITLE_TEXT_CLASS),
    );
    expect(skeleton.querySelector('.skeleton .skeleton')).toBeNull();
  });
});
