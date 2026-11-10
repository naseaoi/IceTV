import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { adminPost } from '@/features/admin/lib/api';
import { localPreferenceToggleDefinitions } from '@/lib/local-preference-toggles';
import type { AdminConfig } from '@/types/admin';

import SiteConfigTab from './SiteConfigTab';

jest.mock('@/features/admin/lib/api', () => ({
  adminPost: jest.fn(),
}));

const config = {
  SiteConfig: {
    SiteName: 'IceTV',
    SiteIcon: '',
    Announcement: '',
    FooterText: '',
    EnableLiveEntry: false,
    EnableDanmaku: false,
    DisableYellowFilter: false,
  },
} as AdminConfig;

const switchNames = [
  '切换直播入口显示',
  '切换NSFW模式',
  '切换播放器弹幕',
  ...localPreferenceToggleDefinitions.map(({ title }) => `切换${title}`),
];

beforeEach(() => {
  jest.clearAllMocks();
});

it('使用四个设置分组，保留字段标签并由外层提供保存按钮', () => {
  render(<SiteConfigTab config={config} refreshConfig={jest.fn()} />);

  expect(
    screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
  ).toEqual(['基本信息', '数据与图片代理', '功能', '本地设置默认值']);
  for (const name of ['站点名称', '站点图标', '站点须知', '底部声明']) {
    expect(screen.getByRole('textbox', { name })).toBeInTheDocument();
  }
  expect(screen.getAllByRole('switch')).toHaveLength(switchNames.length);
  expect(
    screen.queryByRole('button', { name: /保存/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/PNG\/JPEG|需同时配置|这里的设置会作为|开启后，允许/),
  ).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('留空使用默认文案')).toBeInTheDocument();
});

it.each(switchNames)('%s 使用 checked 状态并同步未保存状态', (name) => {
  const onDirtyChange = jest.fn();
  render(
    <SiteConfigTab
      config={config}
      refreshConfig={jest.fn()}
      onDirtyChange={onDirtyChange}
    />,
  );
  const toggle = screen.getByRole('switch', { name });
  const initialChecked = toggle.getAttribute('aria-checked') === 'true';
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);

  fireEvent.click(toggle);
  expect(screen.getByRole('switch', { name, checked: !initialChecked })).toBe(
    toggle,
  );
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);

  fireEvent.click(toggle);
  expect(screen.getByRole('switch', { name, checked: initialChecked })).toBe(
    toggle,
  );
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(adminPost).not.toHaveBeenCalled();
});

it.each([
  { success: true, message: '弹幕服务连接正常，测试搜索返回 2 条结果' },
  {
    success: false,
    details: '请检查环境变量 DANMAKU_API_BASE_URL 是否已正确设置',
  },
])('展示弹幕连接结果 $success，测试连接不提交表单', async (result) => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue({
    json: async () => result,
  });
  global.fetch = fetchMock;
  try {
    render(<SiteConfigTab config={config} refreshConfig={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '测试弹幕连接' }));
    expect(screen.getByRole('button', { name: '测试中' })).toBeDisabled();
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        result.message || result.details || '',
      );
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/danmaku/test', {
      method: 'POST',
    });
    expect(screen.getByRole('button', { name: '测试弹幕连接' })).toBeEnabled();
    expect(adminPost).not.toHaveBeenCalled();
  } finally {
    global.fetch = originalFetch;
  }
});

it('仅在服务端配置代理池时显示分片走代理池开关，默认关闭', () => {
  const { unmount } = render(
    <SiteConfigTab config={config} refreshConfig={jest.fn()} />,
  );
  expect(
    screen.queryByRole('switch', { name: '切换视频分片走代理池' }),
  ).not.toBeInTheDocument();
  unmount();

  const onDirtyChange = jest.fn();
  render(
    <SiteConfigTab
      config={
        {
          ...config,
          SiteConfig: {
            ...config.SiteConfig,
            UpstreamProxyPoolConfigured: true,
          },
        } as AdminConfig
      }
      refreshConfig={jest.fn()}
      onDirtyChange={onDirtyChange}
    />,
  );
  const toggle = screen.getByRole('switch', {
    name: '切换视频分片走代理池',
    checked: false,
  });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
});

it('配置未就绪时保持空内容', () => {
  const { container } = render(
    <SiteConfigTab config={null} refreshConfig={jest.fn()} />,
  );
  expect(container).toBeEmptyDOMElement();
});
