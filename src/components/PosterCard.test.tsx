import { render } from '@testing-library/react';

import PosterCard from '@/components/PosterCard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    prefetch: jest.fn(),
    push: jest.fn(),
  }),
}));

jest.mock('@/components/CoverImage', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <div aria-label={alt} />,
}));

jest.mock('@/hooks/useLongPress', () => ({
  useLongPress: () => ({}),
}));

describe('PosterCard', () => {
  it('聚焦时保留卡片缩放并保持封面圆角裁剪', () => {
    const { container } = render(
      <PosterCard title='测试影片' poster='/poster.webp' />,
    );

    const card = container.firstElementChild;
    const poster = card?.firstElementChild;

    expect(card).toHaveClass('hover:scale-[1.025]');
    expect(card).toHaveClass('active:scale-[0.97]');
    expect(poster).toHaveClass(
      'poster-rounded-clip',
      'overflow-hidden',
      'rounded-lg',
    );
  });
});
