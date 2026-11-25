import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

import { FavoritePreviewSkeleton } from '@/features/favorites/components/FavoritePreviewSkeleton';

jest.mock('@/components/ScrollableRow', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('FavoritePreviewSkeleton', () => {
  it('按收藏数量渲染海报骨架', () => {
    const { container } = render(<FavoritePreviewSkeleton count={3} />);

    expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(3);
    expect(
      container.querySelectorAll('[data-source-badge-skeleton]'),
    ).toHaveLength(0);
  });

  it('已知没有收藏时用虚线占位占住整排，不提前显示空状态文案', () => {
    const { container } = render(<FavoritePreviewSkeleton count={0} />);

    expect(container.querySelectorAll('.border-dashed')).not.toHaveLength(0);
    expect(
      container.querySelectorAll('.skeleton.aspect-\\[2\\/3\\]'),
    ).toHaveLength(0);
    expect(container).not.toHaveTextContent('还没有收藏');
  });
});
