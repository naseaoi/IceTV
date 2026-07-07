import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import CoverImage from '@/components/CoverImage';
import { clearCoverImageCacheForTests } from '@/lib/cover-image-cache';
import { DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY } from '@/lib/douban-source';

jest.mock('next/image', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    __esModule: true,
    default: React.forwardRef<
      HTMLImageElement,
      {
        src: string;
        alt: string;
        onLoad?: () => void;
        onError?: () => void;
        className?: string;
      }
    >(({ src, alt, onLoad, onError, className }, ref) => (
      <img
        ref={ref}
        data-testid='cover-image'
        src={src}
        alt={alt}
        className={className}
        onLoad={onLoad}
        onError={onError}
      />
    )),
  };
});

describe('CoverImage', () => {
  beforeEach(() => {
    clearCoverImageCacheForTests();
    localStorage.clear();
    localStorage.setItem(
      DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY,
      'cmliussss-cdn-ali',
    );
  });

  afterEach(() => {
    jest.useRealTimers();
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

  it('同步已完成但未触发 load 的图片状态', async () => {
    jest.useFakeTimers();

    render(
      <CoverImage
        src='https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2931173550.jpg'
        alt='豆瓣封面'
        priority
      />,
    );

    const image = screen.getByTestId('cover-image');
    expect(image).toHaveClass('opacity-0');

    Object.defineProperty(image, 'complete', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(image, 'naturalWidth', {
      configurable: true,
      value: 270,
    });

    act(() => {
      jest.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(image).toHaveClass('opacity-100');
    });
  });
});
