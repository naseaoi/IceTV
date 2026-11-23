import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import SearchPageClient from '@/features/search/components/SearchPageClient';
import { useSearchAggregation } from '@/features/search/hooks/useSearchAggregation';
import { useSearchExecution } from '@/features/search/hooks/useSearchExecution';
import { useSearchViewMode } from '@/features/search/hooks/useSearchViewMode';
import type { SearchResult } from '@/lib/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams({ q: 'Title' }),
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
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/SearchResultFilter', () => ({
  __esModule: true,
  default: () => null,
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

describe('搜索结果区状态', () => {
  it('原始结果已到达而匹配模块未就绪时继续显示骨架', () => {
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

  it('搜索仍在进行且筛选暂无可展示结果时显示骨架', () => {
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

  it('全部源失败后显示错误，重试期间恢复骨架', () => {
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
