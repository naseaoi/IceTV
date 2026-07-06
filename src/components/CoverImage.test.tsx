import { fireEvent, render, screen } from '@testing-library/react';

import CoverImage from '@/components/CoverImage';
import { clearCoverImageCacheForTests } from '@/lib/cover-image-cache';
import { DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY } from '@/lib/douban-source';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    src,
    alt,
    onLoad,
    onError,
  }: {
    src: string;
    alt: string;
    onLoad?: () => void;
    onError?: () => void;
  }) => (
    <img
      data-testid='cover-image'
      src={src}
      alt={alt}
      onLoad={onLoad}
      onError={onError}
    />
  ),
}));

describe('CoverImage', () => {
  beforeEach(() => {
    clearCoverImageCacheForTests();
    localStorage.clear();
    localStorage.setItem(
      DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY,
      'cmliussss-cdn-ali',
    );
  });

  it('按当前豆瓣图片代理加载，失败后直接显示占位', () => {
    render(
      <CoverImage
        src='https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2931173550.jpg'
        alt='豆瓣封面'
        priority
      />,
    );

    const image = screen.getByTestId('cover-image');
    expect(image).toHaveAttribute(
      'src',
      'https://img.doubanio.cmliussss.com/view/photo/s_ratio_poster/public/p2931173550.jpg',
    );

    fireEvent.error(image);

    expect(screen.getByText('无封面')).toBeInTheDocument();
    expect(screen.queryByTestId('cover-image')).not.toBeInTheDocument();
  });
});
