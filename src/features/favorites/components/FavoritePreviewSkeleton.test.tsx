import type { ReactNode } from 'react';
import { render } from '@testing-library/react';

import { FavoritePreviewSkeleton } from '@/features/favorites/components/FavoritePreviewSkeleton';

jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('FavoritePreviewSkeleton', () => {
  it('按收藏数量渲染海报骨架', () => {
    const { container } = render(<FavoritePreviewSkeleton count={3} />);

    expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(3);
  });

  it('没有收藏计数时保持空态布局高度', () => {
    const { container } = render(<FavoritePreviewSkeleton count={0} />);
    const emptyPlaceholder = container.querySelector('.min-h-\\[198px\\]');

    expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(0);
    expect(emptyPlaceholder).toHaveClass('sm:min-h-[324px]');
  });
});
