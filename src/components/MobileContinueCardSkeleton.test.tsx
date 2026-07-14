import { render } from '@testing-library/react';

import MobileContinueCardSkeleton from '@/components/MobileContinueCardSkeleton';

describe('MobileContinueCardSkeleton', () => {
  it('与移动端继续观看卡片使用相同外框和封面宽度', () => {
    const { container } = render(<MobileContinueCardSkeleton />);
    const skeleton = container.querySelector('[data-mobile-continue-skeleton]');
    const poster = skeleton?.querySelector('.w-\\[80px\\]');
    const progress = skeleton?.querySelector('.left-\\[80px\\]');

    expect(skeleton).toHaveClass('h-[120px]', 'w-[232px]', 'rounded-xl');
    expect(poster).toBeInTheDocument();
    expect(progress).toBeInTheDocument();
  });
});
