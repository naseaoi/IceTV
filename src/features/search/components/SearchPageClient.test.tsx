import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense, useState } from 'react';

import SearchPageClient from '@/features/search/components/SearchPageClient';
import SearchResultFilter from '@/features/search/components/SearchResultFilter';
import { useSearchAggregation } from '@/features/search/hooks/useSearchAggregation';
import { useSearchExecution } from '@/features/search/hooks/useSearchExecution';
import { useSearchViewMode } from '@/features/search/hooks/useSearchViewMode';
import {
  SEARCH_DESKTOP_BAR_ROW_CLASS,
  SEARCH_FILTER_GROUP_SHAPE_CLASS,
  SEARCH_FILTER_TRIGGER_SHAPE_CLASS,
} from '@/features/search/lib/search-layout';
import type { SearchResult } from '@/lib/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: jest.fn(() => new URLSearchParams({ q: 'Title' })),
}));
jest.mock('@/components/AuthenticatedRoute', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({
    session: { status: 'authenticated', role: 'user' },
  }),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/components/SearchBox', () => ({
  ...jest.requireActual('@/components/SearchBox'),
  __esModule: true,
  default: () => null,
}));
jest.mock('@/features/search/components/SearchResultFilter', () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));
jest.mock('@/components/VideoCard', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));
jest.mock('@/features/play/lib/danmaku/navigation-warmup', () => ({
  warmupDanmakuSearchForNavigation: jest.fn(),
}));
jest.mock('@/features/search/components/MobileSearchFilterControls', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/features/search/components/SearchHistory', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/features/search/components/SearchPageSkeleton', () => ({
  SearchResultsLoading: () => <div role='status' aria-label='正在搜索' />,
}));
jest.mock('@/features/search/components/VirtualizedSearchGrid', () => ({
  VirtualizedSearchGrid: <T,>({
    items,
    getKey,
    renderItem,
  }: {
    items: T[];
    getKey: (item: T) => string;
    renderItem: (item: T) => ReactNode;
  }) => (
    <div>
      {items.map((item) => (
        <div key={getKey(item)}>{renderItem(item)}</div>
      ))}
    </div>
  ),
}));
jest.mock('@/features/search/hooks/useSearchAggregation', () => ({
  reconcileSearchFilter: jest.requireActual(
    '@/features/search/hooks/useSearchAggregation',
  ).reconcileSearchFilter,
  useSearchAggregation: jest.fn(),
}));
jest.mock('@/features/search/hooks/useSearchExecution', () => ({
  clearSearchSnapshotCache: jest.fn(),
  useSearchExecution: jest.fn(),
}));
jest.mock('@/features/search/hooks/useSearchHistory', () => ({
  useSearchHistory: () => ({ history: [], loading: false }),
}));
jest.mock('@/features/search/hooks/useSearchViewMode', () => ({
  useSearchViewMode: jest.fn(),
}));

const item: SearchResult = {
  id: '1',
  title: 'Title',
  poster: '',
  episodes: ['/episode.m3u8'],
  episodes_titles: ['1'],
  year: '2026',
  source: 'source',
  source_name: 'Source',
};

function setup({
  results = [],
  loading = false,
  matching = false,
  failed = false,
  retrying = false,
  error = null,
}: {
  results?: SearchResult[];
  loading?: boolean;
  matching?: boolean;
  failed?: boolean;
  retrying?: boolean;
  error?: string | null;
} = {}) {
  jest.mocked(useSearchExecution).mockReturnValue({
    error,
    retry: jest.fn(),
    failedSources: failed ? [{ key: 'source', name: 'Source' }] : [],
    retryingFailed: retrying,
    retryFailedSources: jest.fn(),
    isLoading: loading,
    setIsLoading: jest.fn(),
    showResults: true,
    setShowResults: jest.fn(),
    searchResults: results,
    totalSources: 1,
    completedSources: loading ? 0 : 1,
    useFluidSearch: true,
    setUseFluidSearch: jest.fn(),
  });
  jest.mocked(useSearchAggregation).mockReturnValue({
    isMatchingLoading: matching,
    filterOptions: { categoriesAll: [], categoriesAgg: [] },
    filteredAllResults: results,
    filteredAggResults: [],
    getGroupRef: jest.fn(),
  });
  jest.mocked(useSearchViewMode).mockReturnValue(['agg', jest.fn()]);
}

describe('搜索筛选栏几何', () => {
  it('查询参数等待期间由外层路由边界承接', () => {
    const { SearchPageSkeleton } = jest.requireActual<
      typeof import('@/features/search/components/SearchPageSkeleton')
    >('@/features/search/components/SearchPageSkeleton');
    const pending = new Promise(() => undefined);
    jest.mocked(useSearchParams).mockImplementation(() => {
      throw pending;
    });

    try {
      render(
        <Suspense fallback={<div role='status'>等待查询参数</div>}>
          <SearchPageSkeleton />
        </Suspense>,
      );
      expect(screen.getByRole('status')).toHaveTextContent('等待查询参数');
    } finally {
      jest
        .mocked(useSearchParams)
        .mockReturnValue(
          new URLSearchParams({ q: 'Title' }) as ReturnType<
            typeof useSearchParams
          >,
        );
    }
  });

  it('骨架与真实栏共用行、筛选组和按钮的几何常量', () => {
    const { SearchPageSkeleton } = jest.requireActual<
      typeof import('@/features/search/components/SearchPageSkeleton')
    >('@/features/search/components/SearchPageSkeleton');
    const { default: SearchResultFilter } = jest.requireActual<
      typeof import('@/features/search/components/SearchResultFilter')
    >('@/features/search/components/SearchResultFilter');

    const skeleton = render(<SearchPageSkeleton />);
    setup({ loading: true });
    const page = render(<SearchPageClient />);
    const filter = render(
      <SearchResultFilter categories={[]} values={{}} onChange={jest.fn()} />,
    );

    for (const { container } of [skeleton, page]) {
      expect(
        container.querySelector('[data-nav-subbar]')?.firstElementChild,
      ).toHaveClass(SEARCH_DESKTOP_BAR_ROW_CLASS);
    }
    for (const { container } of [skeleton, filter]) {
      const group = container.getElementsByClassName(
        SEARCH_FILTER_GROUP_SHAPE_CLASS,
      )[0];
      expect(group).toBeInTheDocument();
      const triggers = group.getElementsByClassName(
        SEARCH_FILTER_TRIGGER_SHAPE_CLASS,
      );
      expect(triggers.length).toBeGreaterThan(0);
      for (const trigger of Array.from(triggers)) {
        expect(trigger.textContent).not.toBe('');
      }
    }
  });
});

describe('搜索结果区状态', () => {
  it('原始结果已到达而匹配模块未就绪时继续显示搜索动画', () => {
    setup({ results: [item], matching: true });
    render(<SearchPageClient />);

    expect(
      screen.getByRole('status', { name: '正在搜索' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('当前筛选无结果')).not.toBeInTheDocument();
    expect(screen.queryByText('未找到相关结果')).not.toBeInTheDocument();
  });

  it('搜索完成且没有原始结果时显示未找到相关结果', () => {
    setup();
    render(<SearchPageClient />);

    expect(screen.getByText('未找到相关结果')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: '正在搜索' }),
    ).not.toBeInTheDocument();
  });

  it('搜索完成且筛选滤空时显示当前筛选无结果', () => {
    setup({ results: [item] });
    render(<SearchPageClient />);

    expect(screen.getByText('当前筛选无结果')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: '正在搜索' }),
    ).not.toBeInTheDocument();
  });

  it('搜索仍在进行且筛选暂无可展示结果时显示搜索动画', () => {
    setup({ results: [item], loading: true });
    render(<SearchPageClient />);

    expect(
      screen.getByRole('status', { name: '正在搜索' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('当前筛选无结果')).not.toBeInTheDocument();
  });

  it('可展示结果到达后立即显示，不等待其余源或匹配模块', () => {
    setup({ results: [item], loading: true, matching: true });
    jest.mocked(useSearchViewMode).mockReturnValue(['all', jest.fn()]);
    render(<SearchPageClient />);

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: '正在搜索' }),
    ).not.toBeInTheDocument();
  });

  it('全部源失败后显示错误，重试期间恢复搜索动画', () => {
    setup({ failed: true });
    const { rerender } = render(<SearchPageClient />);
    expect(screen.getByText('搜索失败')).toBeInTheDocument();
    expect(screen.queryByText('未找到相关结果')).not.toBeInTheDocument();

    setup({ failed: true, retrying: true });
    rerender(<SearchPageClient />);
    expect(
      screen.getByRole('status', { name: '正在搜索' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('搜索失败')).not.toBeInTheDocument();
  });

  it('搜索中断且没有原始结果时只显示已有错误提示', () => {
    setup({ results: [], error: '搜索未完成' });
    render(<SearchPageClient />);

    expect(screen.getAllByText('搜索未完成')).toHaveLength(1);
    expect(screen.queryByText('未找到相关结果')).not.toBeInTheDocument();
  });

  it('搜索中断后已到达的结果被筛选滤空时显示当前筛选无结果', () => {
    setup({ results: [item], error: '搜索未完成' });
    render(<SearchPageClient />);

    expect(screen.getAllByText('搜索未完成')).toHaveLength(1);
    expect(screen.getByText('当前筛选无结果')).toBeInTheDocument();
  });
});

it('切回聚合视图时将已经合并消失的年份筛选重置为全部', () => {
  setup({ results: [item] });
  jest.mocked(useSearchViewMode).mockImplementation(function useTestMode() {
    return useState<'agg' | 'all'>('agg');
  });
  let years = ['all', 'unknown'];
  jest.mocked(useSearchAggregation).mockImplementation(() => ({
    isMatchingLoading: false,
    filterOptions: {
      categoriesAll: [
        {
          key: 'year',
          label: '年份',
          options: ['all', 'unknown'].map((value) => ({ label: value, value })),
        },
      ],
      categoriesAgg: [
        {
          key: 'year',
          label: '年份',
          options: years.map((value) => ({ label: value, value })),
        },
      ],
    },
    filteredAllResults: [item],
    filteredAggResults: [],
    getGroupRef: jest.fn(),
  }));
  const { rerender } = render(<SearchPageClient />);
  act(() =>
    jest.mocked(SearchResultFilter).mock.calls.at(-1)![0].onChange({
      source: 'all',
      title: 'all',
      year: 'unknown',
      yearOrder: 'none',
    }),
  );
  expect(
    jest.mocked(useSearchAggregation).mock.calls.at(-1)![0].filterAgg.year,
  ).toBe('unknown');
  fireEvent.click(screen.getByRole('checkbox', { name: '聚合' }));
  years = ['all', '2026'];
  rerender(<SearchPageClient />);
  fireEvent.click(screen.getByRole('checkbox', { name: '聚合' }));
  expect(
    jest.mocked(useSearchAggregation).mock.calls.at(-1)![0].filterAgg.year,
  ).toBe('all');
});
