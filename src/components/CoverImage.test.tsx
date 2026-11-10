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

const mockImageRender = jest.fn();

const imageStateDescriptors = (['complete', 'naturalWidth'] as const).map(
  (name) =>
    [
      name,
      Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, name),
    ] as const,
);

// jsdom 中带 src 的图片始终未完成，用它模拟浏览器缓存命中
function mockImagesComplete() {
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => 270,
  });
}

function restoreImageState() {
  for (const [name, descriptor] of imageStateDescriptors) {
    if (descriptor) {
      Object.defineProperty(HTMLImageElement.prototype, name, descriptor);
    } else {
      Reflect.deleteProperty(HTMLImageElement.prototype, name);
    }
  }
}

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
        decoding?: 'async' | 'sync' | 'auto';
        loading?: 'eager' | 'lazy';
        loader?: (input: {
          src: string;
          width: number;
          quality?: number;
        }) => string;
        quality?: number;
      }
    >((props, ref) => {
      mockImageRender(props);
      const { src, alt, onLoad, onError, className, loader, quality } = props;
      return (
        <img
          ref={ref}
          data-testid='cover-image'
          src={loader ? loader({ src, width: 128, quality }) : src}
          alt={alt}
          className={className}
          decoding={props.decoding}
          loading={props.loading}
          onLoad={onLoad}
          onError={onError}
        />
      );
    }),
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
    mockImageRender.mockClear();
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
    restoreImageState();
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

  it('豆瓣图片自动模式依次换用镜像，并在本标签页记住可用镜像', () => {
    localStorage.setItem(DOUBAN_IMAGE_PROXY_TYPE_STORAGE_KEY, 'auto');
    const src =
      'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg';
    const { unmount } = render(
      <CoverImage src={src} alt='豆瓣封面' priority />,
    );

    expect(screen.getByTestId('cover-image')).toHaveAttribute(
      'src',
      'https://img.doubanio.cmliussss.net/view/photo/s_ratio_poster/public/p1.jpg',
    );
    fireEvent.error(screen.getByTestId('cover-image'));
    const aliUrl =
      'https://img.doubanio.cmliussss.com/view/photo/s_ratio_poster/public/p1.jpg';
    expect(screen.getByTestId('cover-image')).toHaveAttribute('src', aliUrl);
    fireEvent.load(screen.getByTestId('cover-image'));
    unmount();

    render(
      <CoverImage
        src='https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2.jpg'
        alt='另一张封面'
        priority
      />,
    );
    expect(screen.getByTestId('cover-image').getAttribute('src')).toContain(
      'img.doubanio.cmliussss.com',
    );
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
      'skeleton-surface',
    );
    expect(
      document.querySelector('[data-cover-loading-backdrop] .skeleton-sweep'),
    ).not.toBeInTheDocument();

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

  it('加载很快时不显示扫光也不播放淡入', () => {
    jest.useFakeTimers();
    const animate = jest.fn(() => ({ cancel: jest.fn() }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });

    try {
      render(
        <CoverImage
          src='https://covers.example.com/fast.jpg'
          alt='快速封面'
          priority
        />,
      );

      act(() => {
        jest.advanceTimersByTime(150);
      });
      fireEvent.load(screen.getByTestId('cover-image'));
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(
        document.querySelector('[data-cover-loading-backdrop]'),
      ).toHaveAttribute('data-cover-state', 'revealed');
      expect(
        document.querySelector('[data-cover-loading-backdrop] .skeleton-sweep'),
      ).not.toBeInTheDocument();
      expect(animate).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
  });

  it('加载较慢时显示扫光并在完成后淡入', () => {
    jest.useFakeTimers();
    const animate = jest.fn(() => ({ cancel: jest.fn() }));
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = jest.fn(() => ({ matches: false })) as never;

    try {
      render(
        <CoverImage
          src='https://covers.example.com/slow.jpg'
          alt='慢速封面'
          priority
        />,
      );

      act(() => {
        jest.advanceTimersByTime(200);
      });
      expect(
        document.querySelector('[data-cover-loading-backdrop] .skeleton-sweep'),
      ).toBeInTheDocument();

      fireEvent.load(screen.getByTestId('cover-image'));

      expect(animate).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'animate');
      window.matchMedia = originalMatchMedia;
    }
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
      jest.advanceTimersByTime(19_999);
    });
    expect(screen.getByTestId('cover-image')).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(screen.getByText('无封面')).toBeInTheDocument();
    expect(screen.queryByTestId('cover-image')).not.toBeInTheDocument();
  });

  it('超时不写入失败缓存，重新挂载会再次加载', () => {
    jest.useFakeTimers();
    const src =
      'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2931173550.jpg';

    const { unmount } = render(
      <CoverImage src={src} alt='超时封面' priority />,
    );
    act(() => {
      jest.advanceTimersByTime(20_000);
    });
    expect(screen.getByText('无封面')).toBeInTheDocument();
    unmount();

    render(<CoverImage src={src} alt='超时封面' priority />);
    expect(screen.getByTestId('cover-image')).toBeInTheDocument();
  });

  it('缓存命中时首帧直接显示且不展示加载态', async () => {
    const src =
      'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2931173550.jpg';
    markCoverImagesLoaded([src]);
    mockImagesComplete();

    render(<CoverImage src={src} alt='已缓存封面' priority />);

    expect(mockImageRender.mock.calls[0][0]).toMatchObject({
      className: expect.stringContaining('opacity-100'),
      decoding: 'sync',
      loading: 'eager',
    });
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
      document.querySelector('[data-cover-loading-backdrop] .skeleton-sweep'),
    ).not.toBeInTheDocument();

    fireEvent.load(image);

    await waitFor(() => {
      expect(image).toHaveClass('opacity-100');
    });
    expect(document.querySelector('[data-cover-loading-backdrop]')).toHaveClass(
      'opacity-0',
    );
    expect(
      document.querySelector('[data-cover-loading-backdrop] .skeleton-sweep'),
    ).not.toBeInTheDocument();
  });

  it('有显示记录但图片仍需下载时回到普通加载流程', () => {
    jest.useFakeTimers();
    const src = 'https://covers.example.com/other-width.jpg';
    markCoverImagesLoaded([src]);

    render(<CoverImage src={src} alt='换规格封面' priority />);

    const backdrop = document.querySelector('[data-cover-loading-backdrop]');
    expect(backdrop).toHaveAttribute('data-cover-state', 'loading');
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(
      document.querySelector('[data-cover-loading-backdrop] .skeleton-sweep'),
    ).toBeInTheDocument();

    fireEvent.load(screen.getByTestId('cover-image'));
    expect(backdrop).toHaveAttribute('data-cover-state', 'revealed');
  });

  it('恢复浏览器缓存时保持服务端水合一致', async () => {
    const src =
      'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p2931173550.jpg';
    const serverHtml = renderToString(
      <CoverImage src={src} alt='水合缓存封面' />,
    );
    expect(serverHtml).toContain('data-cover-state="loading"');

    markCoverImagesLoaded([src]);
    mockImagesComplete();

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
        container.querySelector('.skeleton-sweep'),
      ).not.toBeInTheDocument();
    } finally {
      if (root) {
        await act(async () => root?.unmount());
      }
      container.remove();
    }
  });

  it('客户端已渲染过缓存封面也不改变后续服务端输出', () => {
    const src = 'https://covers.example.com/hydration.jpg';
    markCoverImagesLoaded([src]);
    render(<CoverImage src={src} alt='客户端缓存封面' priority />);

    const serverHtml = renderToString(
      <CoverImage src={src} alt='服务端封面' priority />,
    );

    expect(serverHtml).toContain('data-cover-state="loading"');
    expect(serverHtml).toContain('decoding="async"');
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

  it('代理失败且直连成功后，同域名其他封面直接直连', () => {
    const { unmount } = render(
      <CoverImage src='https://covers.example.com/a.jpg' alt='封面' priority />,
    );
    fireEvent.error(screen.getByTestId('cover-image'));
    fireEvent.load(screen.getByTestId('cover-image'));
    unmount();

    render(
      <CoverImage src='https://covers.example.com/b.jpg' alt='封面' priority />,
    );
    expect(screen.getByTestId('cover-image')).toHaveAttribute(
      'src',
      'https://covers.example.com/b.jpg',
    );
  });

  it('代理与直连都失败时，同域名其他封面仍先走代理', () => {
    const { unmount } = render(
      <CoverImage
        src='https://covers.example.com/broken.jpg'
        alt='封面'
        priority
      />,
    );
    fireEvent.error(screen.getByTestId('cover-image'));
    fireEvent.error(screen.getByTestId('cover-image'));
    expect(screen.getByText('无封面')).toBeInTheDocument();
    unmount();

    render(
      <CoverImage src='https://covers.example.com/b.jpg' alt='封面' priority />,
    );
    expect(screen.getByTestId('cover-image').getAttribute('src')).toMatch(
      /^\/api\/image-proxy\?/,
    );
  });

  it('Bangumi 封面代理失败后回退原图直连一次', () => {
    const src = 'https://lain.bgm.tv/pic/cover/l/27/ff/377130_wDU1x.jpg';
    render(<CoverImage src={src} alt='番剧封面' priority />);

    expect(screen.getByTestId('cover-image').getAttribute('src')).toMatch(
      /^\/api\/bangumi-cover\//,
    );

    fireEvent.error(screen.getByTestId('cover-image'));
    expect(screen.getByTestId('cover-image')).toHaveAttribute('src', src);

    fireEvent.error(screen.getByTestId('cover-image'));
    expect(screen.getByText('无封面')).toBeInTheDocument();
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
