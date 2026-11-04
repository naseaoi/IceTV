import type { DragEndEvent } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { adminGet } from '@/features/admin/lib/api';
import type { AdminConfig } from '@/types/admin';

import CategoryConfig from './CategoryConfigTab';
import LiveSourceConfig from './LiveSourceConfigTab';
import VideoSourceConfig from './VideoSourceConfigTab';

let mockOnDragEnd: (event: DragEndEvent) => void;

jest.mock('@dnd-kit/core', () => ({
  ...jest.requireActual('@dnd-kit/core'),
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd: typeof mockOnDragEnd;
  }) => {
    mockOnDragEnd = onDragEnd;
    return <>{children}</>;
  },
  closestCenter: jest.fn(),
  PointerSensor: jest.fn(),
  TouchSensor: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(),
}));

jest.mock('@dnd-kit/sortable', () => ({
  arrayMove: jest.requireActual('@dnd-kit/sortable').arrayMove,
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: jest.fn(),
  useSortable: jest.fn(() => ({
    attributes: { role: 'button', tabIndex: 0 },
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
  })),
}));

jest.mock('@/features/admin/lib/api', () => ({
  adminGet: jest.fn(),
  adminPost: jest.fn(),
}));

const config = {
  SourceConfig: [
    {
      name: 'Alpha 视频',
      key: 'video-first',
      api: 'https://first.test/api',
      detail: 'https://detail.test/catalog',
      from: 'custom',
    },
    {
      name: 'Beta 视频',
      key: 'video-second',
      api: 'https://second.test/api',
      from: 'custom',
    },
  ],
  LiveConfig: [
    {
      name: 'Alpha 直播',
      key: 'live-first',
      url: 'https://first.test/playlist.m3u',
      from: 'custom',
    },
    {
      name: 'Beta 直播',
      key: 'live-second',
      url: 'https://second.test/playlist.m3u',
      from: 'custom',
    },
  ],
  CustomCategories: [
    { name: 'Alpha 分类', query: 'Popular', type: 'movie', from: 'custom' },
    { query: 'Classic', type: 'tv', from: 'custom' },
  ],
} as AdminConfig;

const cases = [
  {
    label: '视频源',
    Component: VideoSourceConfig,
    first: 'Alpha 视频',
    second: 'Beta 视频',
    firstId: 'video-first',
    secondId: 'video-second',
    queries: [' ALPHA ', ' VIDEO-FIRST ', ' FIRST.TEST ', ' DETAIL.TEST '],
    sharedQuery: 'video-',
  },
  {
    label: '直播源',
    Component: LiveSourceConfig,
    first: 'Alpha 直播',
    second: 'Beta 直播',
    firstId: 'live-first',
    secondId: 'live-second',
    queries: [' ALPHA ', ' LIVE-FIRST ', ' FIRST.TEST '],
    sharedQuery: 'live-',
  },
  {
    label: '分类',
    Component: CategoryConfig,
    first: 'Alpha 分类',
    second: 'Classic',
    firstId: 'Popular:movie',
    secondId: 'Classic:tv',
    queries: [' ALPHA ', ' POPULAR '],
    sharedQuery: 'a',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  (adminGet as jest.Mock).mockResolvedValue({ stats: [] });
});

describe.each(cases)('$label列表搜索', (testCase) => {
  const { Component, label, first, second, firstId, secondId } = testCase;

  async function renderTab() {
    await act(async () => {
      render(<Component config={config} refreshConfig={jest.fn()} />);
    });
    return screen.getByRole('searchbox', { name: `搜索${label}` });
  }

  it.each(testCase.queries)(
    '按字段匹配并忽略大小写和首尾空格：%s',
    async (query) => {
      const search = await renderTab();
      expect(screen.getByText(first)).toBeInTheDocument();
      expect(screen.getByText(second)).toBeInTheDocument();

      fireEvent.change(search, { target: { value: query } });

      expect(screen.getByText(first)).toBeInTheDocument();
      expect(screen.queryByText(second)).not.toBeInTheDocument();
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    },
  );

  it('在列表内展示空状态，清除搜索恢复全部行', async () => {
    const search = await renderTab();
    fireEvent.change(search, { target: { value: 'no-match' } });

    const list = screen.getByRole('list', { name: `${label}列表` });
    expect(within(list).getByText(`没有匹配的${label}`)).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    if (label === '视频源') {
      expect(
        screen.getByRole('checkbox', { name: '全选当前视频源' }),
      ).toBeDisabled();
    }

    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(screen.getByText(first)).toBeInTheDocument();
    expect(screen.getByText(second)).toBeInTheDocument();
  });

  it('筛选期间禁用手柄且忽略排序事件，清除后恢复排序', async () => {
    const search = await renderTab();
    fireEvent.change(search, { target: { value: testCase.sharedQuery } });

    for (const handle of screen.getAllByRole('button', { name: /拖动排序/ })) {
      expect(handle).toHaveAttribute('aria-disabled', 'true');
      expect(handle).toHaveAttribute('tabindex', '-1');
      expect(handle).toHaveClass('cursor-not-allowed');
    }
    expect(useSortable).toHaveBeenCalledWith({ id: firstId, disabled: true });
    expect(useSortable).toHaveBeenCalledWith({ id: secondId, disabled: true });

    const event = {
      active: { id: firstId },
      over: { id: secondId },
    } as DragEndEvent;
    act(() => mockOnDragEnd(event));
    expect(
      screen.queryByRole('button', { name: '保存排序' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(first);

    fireEvent.change(search, { target: { value: '   ' } });
    expect(useSortable).toHaveBeenCalledWith({ id: firstId, disabled: false });
    expect(
      screen.getByRole('button', { name: `拖动排序 ${first}` }),
    ).toHaveAttribute('aria-disabled', 'false');
    act(() => mockOnDragEnd(event));
    expect(
      screen.getByRole('button', { name: '保存排序' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(second);
  });
});

it('视频源全选和取消全选只影响可见行，并保留隐藏行的选择', async () => {
  await act(async () => {
    render(<VideoSourceConfig config={config} refreshConfig={jest.fn()} />);
  });
  const search = screen.getByRole('searchbox', { name: '搜索视频源' });
  const selectAll = screen.getByRole('checkbox', { name: '全选当前视频源' });

  fireEvent.change(search, { target: { value: 'Alpha' } });
  fireEvent.click(selectAll);
  fireEvent.change(search, { target: { value: '' } });
  expect(selectAll).not.toBeChecked();
  expect(screen.getAllByRole('checkbox')[1]).toBeChecked();
  expect(screen.getAllByRole('checkbox')[2]).not.toBeChecked();

  fireEvent.change(search, { target: { value: 'Beta' } });
  fireEvent.click(selectAll);
  expect(selectAll).toBeChecked();
  expect(screen.getByText('已选 2 个')).toBeVisible();
  fireEvent.click(selectAll);
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getAllByRole('checkbox')[1]).toBeChecked();
  expect(screen.getAllByRole('checkbox')[2]).not.toBeChecked();
  expect(screen.getByText('已选 1 个')).toBeVisible();
});
