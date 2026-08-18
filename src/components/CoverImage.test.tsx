import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

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
  const originalIntersectionObserver = global.IntersectionObserver;
  const originalConnection = Object.getOwnPropertyDescriptor(
    navigator,
    'connection',
  );
  let intersectionOptions: IntersectionObserverInit | undefined;

  beforeEach(() => {
    clearCoverImageCacheForTests();
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(
      DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY,
      'cmliussss-cdn-ali',
    );

    global.IntersectionObserver = class IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];

      constructor(
        _callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        intersectionOptions = options;
      }

      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
      unobserve() {}
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    global.IntersectionObserver = originalIntersectionObserver;
    intersectionOptions = undefined;

    if (originalConnection) {
      Object.defineProperty(navigator, 'connection', originalConnection);
    } else {
      Reflect.deleteProperty(navigator, 'connection');
    }
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
      'cover-loading-backdrop-pending',
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

    await act(async () => {
      await Promise.resolve();
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

  it('在总超时后结束封面等待', () => {
    jest.useFakeTimers();

    render(
      <CoverImage
        src='https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2931173550.jpg'
        alt='超时封面'
        priority
      />,
    );

    act(() => {
      jest.advanceTimersByTime(8000);
    });

    expect(screen.getByText('无封面')).toBeInTheDocument();
    expect(screen.queryByTestId('cover-image')).not.toBeInTheDocument();
  });

  it('缓存命中时首帧直接显示且不展示加载态', async () => {
    const src =
      'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2931173550.jpg';
    markCoverImagesLoaded([src]);

    render(<CoverImage src={src} alt='已缓存封面' priority />);

    const image = screen.getByTestId('cover-image');
    expect(image).toHaveClass('opacity-100');
    expect(document.querySelector('[data-cover-loading-backdrop]')).toHaveClass(
      'opacity-0',
    );
    expect(
      document.querySelector('[data-cover-loading-backdrop]'),
    ).toHaveAttribute('data-cover-state', 'revealed');
    expect(
      document.querySelector('[data-cover-loading-backdrop]'),
    ).not.toHaveClass('cover-loading-backdrop-pending');
    expect(
      document.querySelector('[data-cover-loading-backdrop] .animate-shimmer'),
    ).not.toBeInTheDocument();

    fireEvent.load(image);

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

  it('恢复浏览器缓存时保持服务端水合一致', async () => {
    const src =
      'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2931173550.jpg';
    const serverHtml = renderToString(
      <CoverImage src={src} alt='水合缓存封面' />,
    );
    expect(serverHtml).toContain('data-cover-state="loading"');

    markCoverImagesLoaded([src]);

    const container = document.createElement('div');
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    const recoverableErrors: unknown[] = [];
    let root: Root | undefined;

    try {
      await act(async () => {
        root = hydrateRoot(
          container,
          <CoverImage src={src} alt='水合缓存封面' />,
          {
            onRecoverableError: (error) => recoverableErrors.push(error),
          },
        );
        await Promise.resolve();
      });

      expect(recoverableErrors).toEqual([]);
      expect(
        container.querySelector('[data-cover-loading-backdrop]'),
      ).toHaveAttribute('data-cover-state', 'revealed');
      expect(
        container.querySelector('.animate-shimmer'),
      ).not.toBeInTheDocument();
    } finally {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    }
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

  it('短期内不重试已经最终失败的封面', () => {
    const src = 'https://covers.example.com/missing.jpg';
    const firstRender = render(
      <CoverImage
        src={src}
        alt='失败封面'
        priority
        checkClientCacheBeforeLoad
      />,
    );

    fireEvent.error(screen.getByTestId('cover-image'));
    fireEvent.error(screen.getByTestId('cover-image'));
    expect(screen.getByText('无封面')).toBeInTheDocument();

    firstRender.unmount();
    render(
      <CoverImage
        src={src}
        alt='失败封面'
        priority
        checkClientCacheBeforeLoad
      />,
    );

    expect(screen.getByText('无封面')).toBeInTheDocument();
    expect(screen.queryByTestId('cover-image')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-cover-loading-backdrop]'),
    ).not.toBeInTheDocument();
  });

  it('需要客户端缓存检查时不在服务端输出图片请求', () => {
    const serverHtml = renderToString(
      <CoverImage
        src='https://covers.example.com/deferred.jpg'
        alt='延迟检查封面'
        priority
        checkClientCacheBeforeLoad
      />,
    );

    expect(serverHtml).not.toContain('<img');
    expect(serverHtml).toContain('data-cover-state="loading"');
  });

  it('使用较小的横向封面预加载范围', () => {
    render(
      <CoverImage
        src='https://covers.example.com/poster.jpg'
        alt='延迟加载封面'
      />,
    );

    expect(intersectionOptions).toEqual({
      root: null,
      rootMargin: '520px 180px',
    });
  });

  it.each([
    { effectiveType: '4g', saveData: true },
    { effectiveType: '2g', saveData: false },
  ])('在弱网或省流模式收紧封面预加载范围', (connection) => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: connection,
    });

    render(
      <CoverImage src='https://covers.example.com/poster.jpg' alt='弱网封面' />,
    );

    expect(intersectionOptions).toEqual({
      root: null,
      rootMargin: '320px 96px',
    });
  });
});
