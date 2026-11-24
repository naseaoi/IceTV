import type { DragEndEvent } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { AdminAlert } from '@/features/admin/lib/admin-alerts';
import { adminGet, adminPost } from '@/features/admin/lib/api';
import { showToast } from '@/lib/toast';
import type { AdminConfig } from '@/types/admin';

import CategoryConfig from './CategoryConfigTab';
import LiveSourceConfig from './LiveSourceConfigTab';
import VideoSourceConfig from './VideoSourceConfigTab';

let mockOnDragEnd: (event: DragEndEvent) => void;

const mockRouter = { push: jest.fn(), replace: jest.fn() };
let mockSearchParams = new URLSearchParams();
let mockAlerts: AdminAlert[] = [];
const mockRefreshAlerts = jest.fn();
jest.mock('@/features/admin/components/AdminAlertsProvider', () => ({
  useAdminAlerts: () => mockAlerts,
  useRefreshAdminAlerts: () => mockRefreshAlerts,
}));
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/admin',
  useSearchParams: () => mockSearchParams,
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

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

describe.each(cases.filter(({ label }) => label !== '视频源'))(
  '$label状态筛选',
  ({ Component, label, first, second, firstId, secondId }) => {
    const filteredConfig = {
      ...config,
      LiveConfig: config.LiveConfig!.map((item, index) => ({
        ...item,
        disabled: index === 1,
      })),
      CustomCategories: config.CustomCategories.map((item, index) => ({
        ...item,
        disabled: index === 1,
      })),
    };
    const choose = (value: string) => {
      fireEvent.click(screen.getByRole('button', { name: `筛选${label}状态` }));
      fireEvent.click(screen.getByRole('option', { name: value }));
    };
    const visible = () =>
      within(screen.getByRole('list', { name: `${label}列表` }));

    it('三档状态与关键词取交集，清除搜索保留状态', () => {
      render(<Component config={filteredConfig} refreshConfig={jest.fn()} />);
      expect(visible().getAllByRole('listitem')).toHaveLength(2);
      choose('已启用');
      expect(visible().getByText(first)).toBeInTheDocument();
      expect(visible().queryByText(second)).not.toBeInTheDocument();
      expect(screen.getByText('共 1 个')).toBeInTheDocument();
      choose('已禁用');
      expect(visible().getByText(second)).toBeInTheDocument();
      expect(visible().queryByText(first)).not.toBeInTheDocument();

      const search = screen.getByRole('searchbox', { name: `搜索${label}` });
      fireEvent.change(search, { target: { value: second.toUpperCase() } });
      expect(visible().getByText(second)).toBeInTheDocument();
      fireEvent.change(search, { target: { value: first } });
      expect(visible().getByText(`没有匹配的${label}`)).toBeInTheDocument();
      expect(screen.getByText('共 0 个')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
      expect(visible().getByText(second)).toBeInTheDocument();
      expect(visible().queryByText(first)).not.toBeInTheDocument();
      choose('全部状态');
      expect(visible().getAllByRole('listitem')).toHaveLength(2);
      expect(adminGet).not.toHaveBeenCalled();
      expect(adminPost).not.toHaveBeenCalled();
    });

    it('缺省状态视为启用，仅状态筛选无结果时显示查找空状态', () => {
      render(<Component config={config} refreshConfig={jest.fn()} />);
      choose('已启用');
      expect(visible().getAllByRole('listitem')).toHaveLength(2);
      choose('已禁用');
      expect(visible().getByText(`没有匹配的${label}`)).toBeInTheDocument();
    });

    it('状态筛选禁用拖拽并忽略排序事件，全部状态恢复排序', () => {
      render(<Component config={config} refreshConfig={jest.fn()} />);
      choose('已启用');
      for (const handle of visible().getAllByRole('button', {
        name: /拖动排序/,
      })) {
        expect(handle).toHaveAttribute('aria-disabled', 'true');
        expect(handle).toHaveAttribute('tabindex', '-1');
      }
      expect(useSortable).toHaveBeenCalledWith({ id: firstId, disabled: true });
      expect(useSortable).toHaveBeenCalledWith({
        id: secondId,
        disabled: true,
      });
      const event = {
        active: { id: firstId },
        over: { id: secondId },
      } as DragEndEvent;
      act(() => mockOnDragEnd(event));
      expect(visible().getAllByRole('listitem')[0]).toHaveTextContent(first);
      expect(
        screen.queryByRole('button', { name: '保存排序' }),
      ).not.toBeInTheDocument();

      const search = screen.getByRole('searchbox', { name: `搜索${label}` });
      fireEvent.change(search, { target: { value: 'a' } });
      choose('全部状态');
      expect(
        visible().getByRole('button', { name: `拖动排序 ${first}` }),
      ).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
      expect(
        visible().getByRole('button', { name: `拖动排序 ${first}` }),
      ).toHaveAttribute('aria-disabled', 'false');
      act(() => mockOnDragEnd(event));
      expect(visible().getAllByRole('listitem')[0]).toHaveTextContent(second);
      expect(
        screen.getByRole('button', { name: '保存排序' }),
      ).toBeInTheDocument();
    });
  },
);

describe('视频源状态与线路组合筛选', () => {
  const filteredConfig = {
    ...config,
    SourceConfig: [
      ...config.SourceConfig,
      {
        name: '自动源',
        key: 'auto',
        api: 'https://auto.test',
        from: 'custom',
        proxyMode: 'auto',
      },
      {
        name: '直连源',
        key: 'browser',
        api: 'https://browser.test',
        from: 'custom',
        proxyMode: 'browser',
        disabled: true,
      },
      {
        name: '代理源',
        key: 'server',
        api: 'https://server.test',
        from: 'custom',
        proxyMode: 'server',
        disabled: true,
      },
    ],
  } as AdminConfig;
  const choose = (dimension: string, label: string) => {
    fireEvent.click(screen.getByRole('button', { name: dimension }));
    fireEvent.click(screen.getByRole('option', { name: label }));
  };
  const visible = () =>
    within(screen.getByRole('list', { name: '视频源列表' }));

  it.each([
    ['自动', ['Alpha 视频', 'Beta 视频', '自动源']],
    ['直连', ['直连源']],
    ['代理', ['代理源']],
  ])('按%s线路匹配，缺省线路视为自动', async (label, names) => {
    await act(async () => {
      render(
        <VideoSourceConfig config={filteredConfig} refreshConfig={jest.fn()} />,
      );
    });
    choose('筛选视频源线路', label as string);
    expect(visible().getAllByRole('listitem')).toHaveLength(names.length);
    for (const name of names)
      expect(visible().getByText(name)).toBeInTheDocument();
    expect(screen.getByText(`共 ${names.length} 个`)).toBeInTheDocument();
    for (const handle of visible().getAllByRole('button', {
      name: /拖动排序/,
    })) {
      expect(handle).toHaveAttribute('aria-disabled', 'true');
    }
    choose('筛选视频源线路', '全部线路');
    expect(visible().getAllByRole('listitem')).toHaveLength(5);
    expect(
      visible().getByRole('button', { name: '拖动排序 Alpha 视频' }),
    ).toHaveAttribute('aria-disabled', 'false');
  });

  it('状态与线路取交集，清除搜索保留条件并锁定拖拽', async () => {
    await act(async () => {
      render(
        <VideoSourceConfig config={filteredConfig} refreshConfig={jest.fn()} />,
      );
    });
    choose('筛选视频源状态', '已禁用');
    expect(visible().getAllByRole('listitem')).toHaveLength(2);
    choose('筛选视频源线路', '代理');
    expect(visible().getAllByRole('listitem')).toHaveLength(1);
    expect(visible().getByText('代理源')).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: '搜索视频源' });
    fireEvent.change(search, { target: { value: 'nothing' } });
    expect(visible().getByText('没有匹配的视频源')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: '全选当前视频源' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(visible().getByText('代理源')).toBeInTheDocument();
    choose('筛选视频源线路', '全部线路');
    act(() =>
      mockOnDragEnd({
        active: { id: 'browser' },
        over: { id: 'server' },
      } as DragEndEvent),
    );
    expect(visible().getAllByRole('listitem')[0]).toHaveTextContent('直连源');
    expect(
      screen.queryByRole('button', { name: '保存排序' }),
    ).not.toBeInTheDocument();
    choose('筛选视频源状态', '全部状态');
    expect(
      visible().getByRole('button', { name: '拖动排序 直连源' }),
    ).toHaveAttribute('aria-disabled', 'false');
  });

  it('待清理沿用健康等级并与线路取交集', async () => {
    jest.mocked(adminGet).mockImplementation(async (url) =>
      url.includes('source-health')
        ? {
            items: ['browser', 'server'].map((source) => ({
              source,
              tier: 'poor',
              score: 20,
              searchAttempts: 0,
              searchAvailability: null,
              avgSearchLatencyMs: null,
              playReporterDays: 0,
              playSuccessRate: null,
              lastOkDate: null,
            })),
          }
        : { stats: [] },
    );
    await act(async () => {
      render(
        <VideoSourceConfig config={filteredConfig} refreshConfig={jest.fn()} />,
      );
    });
    choose('筛选视频源状态', '待清理');
    choose('筛选视频源线路', '直连');
    expect(visible().getAllByRole('listitem')).toHaveLength(1);
    expect(visible().getByText('直连源')).toBeInTheDocument();
    choose('筛选视频源线路', '自动');
    expect(visible().getByText('没有匹配的视频源')).toBeInTheDocument();
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

it('直播源刷新完成后通过轻提示反馈', async () => {
  jest.mocked(adminPost).mockResolvedValueOnce({ refreshed: 2, failed: [] });
  const refreshConfig = jest.fn().mockResolvedValue(undefined);
  render(<LiveSourceConfig config={config} refreshConfig={refreshConfig} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '刷新直播源' }));
  });
  expect(adminPost).toHaveBeenCalledWith(
    '/api/admin/live/refresh',
    {},
    '刷新失败',
  );
  expect(refreshConfig).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith('直播源已刷新', 'success');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each([
  [
    { refreshed: 1, failed: [{ key: 'b', name: '乙' }] },
    '已刷新 1 个直播源，1 个失败：乙',
    'error',
  ],
  [
    { refreshed: 0, failed: [{ key: 'b', name: '乙' }] },
    '已刷新 0 个直播源，1 个失败：乙',
    'error',
  ],
  [
    { refreshed: 0, failed: [], liveDisabled: true },
    '直播未开启，已跳过刷新',
    'info',
  ],
])('直播刷新按结果反馈 %#', async (result, message, type) => {
  jest.mocked(adminPost).mockResolvedValueOnce(result);
  render(<LiveSourceConfig config={config} refreshConfig={jest.fn()} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '刷新直播源' }));
  });
  expect(showToast).toHaveBeenCalledTimes(1);
  expect(showToast).toHaveBeenCalledWith(message, type);
});

it.each(cases)(
  '$label排序保存中禁用拖拽并忽略拖动',
  async ({ Component, label, firstId, secondId }) => {
    let resolve!: (value: Record<string, unknown>) => void;
    jest.mocked(adminPost).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await act(async () => {
      render(<Component config={config} refreshConfig={jest.fn()} />);
    });
    act(() =>
      mockOnDragEnd({
        active: { id: firstId },
        over: { id: secondId },
      } as DragEndEvent),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存排序' }));
    });
    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled();
    expect(useSortable).toHaveBeenLastCalledWith(
      expect.objectContaining({ disabled: true }),
    );
    const list = screen.getByRole('list', { name: `${label}列表` });
    const before = list.textContent;
    act(() =>
      mockOnDragEnd({
        active: { id: secondId },
        over: { id: firstId },
      } as DragEndEvent),
    );
    expect(list.textContent).toBe(before);
    await act(async () => {
      resolve({});
    });
  },
);

describe('视频源告警定位', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn();
    mockAlerts = [
      {
        key: 'source-offline:video-second',
        type: 'source-offline',
        message: '视频源「Beta 视频」持续失效，最后成功于 11-18',
        startedAt: 1,
        count: 1,
        sourceDetail: {
          source: 'video-second',
          failureDays: 2,
          failureCount: 21,
          lastSuccessDate: null,
        },
      },
    ];
  });
  afterEach(() => {
    mockAlerts = [];
    mockSearchParams = new URLSearchParams();
  });

  it('告警源标出持续失效，可按告警中筛选', async () => {
    await act(async () => {
      render(<VideoSourceConfig config={config} refreshConfig={jest.fn()} />);
    });
    const alerted = screen.getByText('Beta 视频').closest('li')!;
    expect(within(alerted).getByText(/持续失效/)).toBeInTheDocument();
    expect(
      within(screen.getByText('Alpha 视频').closest('li')!).queryByText(
        /持续失效/,
      ),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '筛选视频源状态' }));
    fireEvent.click(screen.getByRole('option', { name: '告警中' }));
    expect(screen.getByText('Beta 视频')).toBeInTheDocument();
    expect(screen.queryByText('Alpha 视频')).not.toBeInTheDocument();
  });

  it('告警消失时保留已选条件，退出后隐藏告警选项', async () => {
    const view = render(
      <VideoSourceConfig config={config} refreshConfig={jest.fn()} />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '筛选视频源状态' }));
    fireEvent.click(screen.getByRole('option', { name: '告警中' }));
    mockAlerts = [];
    view.rerender(
      <VideoSourceConfig config={config} refreshConfig={jest.fn()} />,
    );
    expect(screen.getByText('没有匹配的视频源')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '筛选视频源状态' }));
    expect(screen.getByRole('option', { name: '告警中' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: '全部状态' }));
    fireEvent.click(screen.getByRole('button', { name: '筛选视频源状态' }));
    expect(
      screen.queryByRole('option', { name: '告警中' }),
    ).not.toBeInTheDocument();
  });

  it('从告警跳转来时清掉筛选、滚到该源并移除定位参数', async () => {
    const view = render(
      <VideoSourceConfig config={config} refreshConfig={jest.fn()} />,
    );
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '筛选视频源状态' }));
    fireEvent.click(screen.getByRole('option', { name: '已禁用' }));
    fireEvent.click(screen.getByRole('button', { name: '筛选视频源线路' }));
    fireEvent.click(screen.getByRole('option', { name: '代理' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索视频源' }), {
      target: { value: 'missing' },
    });
    mockSearchParams = new URLSearchParams(
      'tab=video-source&source=video-second',
    );
    view.rerender(
      <VideoSourceConfig config={config} refreshConfig={jest.fn()} />,
    );
    expect(screen.getByRole('searchbox', { name: '搜索视频源' })).toHaveValue(
      '',
    );
    expect(
      screen.getByRole('button', { name: '筛选视频源状态' }),
    ).toHaveTextContent('全部状态');
    expect(
      screen.getByRole('button', { name: '筛选视频源线路' }),
    ).toHaveTextContent('全部线路');
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(mockRouter.replace).toHaveBeenCalledWith('/admin?tab=video-source', {
      scroll: false,
    });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText('Beta 视频').closest('li')).toHaveAttribute(
      'data-source-key',
      'video-second',
    );
  });
});
