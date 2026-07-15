import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import CoverImage from '@/components/CoverImage';
import {
  clearCoverImageCacheForTests,
  markCoverImagesLoaded,
} from '@/lib/cover-image-cache';
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
        loader?: (input: {
          src: string;
          width: number;
          quality?: number;
        }) => string;
        quality?: number;
      }
    >(({ src, alt, onLoad, onError, className, loader, quality }, ref) => (
      <img
        ref={ref}
        data-testid='cover-image'
        src={loader ? loader({ src, width: 128, quality }) : src}
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
    sessionStorage.clear();
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
    expect(document.querySelector('[data-cover-loading-backdrop]')).toHaveClass(
      'z-[100]',
      'opacity-100',
      'bg-gray-200/70',
      'dark:bg-gray-700/60',
    );
    expect(document.querySelector('.animate-shimmer')).toHaveClass(
      'via-white/20',
      'dark:via-white/12',
    );

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
    expect(document.querySelector('[data-cover-loading-backdrop]')).toHaveClass(
      'opacity-0',
    );
    expect(
      document.querySelector('[data-cover-loading-backdrop]'),
    ).toHaveAttribute('data-cover-state', 'revealed');
  });

  it('缓存命中时直接显示封面，不重复播放淡入动画', async () => {
    const src =
      'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2931173550.jpg';
    markCoverImagesLoaded([src]);

    render(<CoverImage src={src} alt='已缓存封面' priority />);

    const image = screen.getByTestId('cover-image');
    await waitFor(() => {
      expect(image).toHaveClass('opacity-100');
    });
    expect(document.querySelector('[data-cover-loading-backdrop]')).toHaveClass(
      'opacity-0',
    );
    expect(
      document.querySelector('[data-cover-loading-backdrop] .animate-shimmer'),
    ).not.toBeInTheDocument();
  });

  it('普通远程封面通过服务端图片代理加载', () => {
    render(
      <CoverImage
        src='https://covers.example.com/poster.jpg?size=small'
        alt='远程封面'
        priority
      />,
    );

    expect(screen.getByTestId('cover-image')).toHaveAttribute(
      'src',
      '/api/image-proxy?url=https%3A%2F%2Fcovers.example.com%2Fposter.jpg%3Fsize%3Dsmall&width=128&quality=72',
    );
  });

  it('自动模式在服务端代理失败后回退浏览器直连', () => {
    render(
      <CoverImage
        src='https://covers.example.com/poster.jpg'
        alt='自动回退封面'
        priority
      />,
    );

    fireEvent.error(screen.getByTestId('cover-image'));

    expect(screen.getByTestId('cover-image')).toHaveAttribute(
      'src',
      'https://covers.example.com/poster.jpg',
    );
    expect(screen.queryByText('无封面')).not.toBeInTheDocument();
  });
});
