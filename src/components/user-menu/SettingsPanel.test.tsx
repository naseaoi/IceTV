import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { testCustomProxy } from '@/lib/custom-proxy-test';
import { showToast } from '@/lib/toast';

import { SettingsPanel } from './SettingsPanel';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: jest.fn(),
}));
jest.mock('@/lib/browser-storage', () => ({
  readStorage: jest.fn().mockReturnValue(null),
  writeStorage: jest.fn().mockReturnValue(true),
  removeStorage: jest.fn(),
  listStorageKeys: jest.fn().mockReturnValue([]),
}));
jest.mock('@/lib/custom-proxy-test', () => ({
  ...jest.requireActual('@/lib/custom-proxy-test'),
  testCustomProxy: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getAuthInfoFromBrowserCookie).mockReturnValue(null);
  jest.mocked(testCustomProxy).mockResolvedValue(undefined);
});

function selectCustomProxy(index = 0) {
  fireEvent.click(
    screen.getAllByRole('button', { name: '直连（浏览器请求）' })[index],
  );
  fireEvent.click(screen.getByRole('option', { name: '自定义代理' }));
}

it('更换代理使用轻提示并保留设置面板', () => {
  render(<SettingsPanel onClose={jest.fn()} />);
  fireEvent.click(
    screen.getAllByRole('button', { name: '直连（浏览器请求）' })[0],
  );
  fireEvent.click(screen.getByRole('option', { name: 'Cors Proxy By Zwei' }));
  expect(showToast).toHaveBeenCalledWith('更换成功，刷新页面后生效', 'success');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: '本地设置' })).toBeInTheDocument();
});

it.each([
  [0, '请填写豆瓣代理地址'],
  [1, '请填写豆瓣图片代理地址'],
  [2, '请填写 Bangumi 代理地址'],
])('第 %s 项代理地址缺失时显示错误轻提示', (index, message) => {
  render(<SettingsPanel onClose={jest.fn()} />);
  selectCustomProxy(Number(index));
  expect(showToast).toHaveBeenCalledWith(message, 'error');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

it('测试空代理地址时通过错误轻提示反馈', () => {
  render(<SettingsPanel onClose={jest.fn()} />);
  selectCustomProxy();
  jest.mocked(showToast).mockClear();
  fireEvent.click(screen.getByRole('button', { name: '测试' }));
  expect(showToast).toHaveBeenCalledWith('请填写豆瓣代理地址', 'error');
  expect(testCustomProxy).not.toHaveBeenCalled();
});

it.each([
  [false, '测试通过，豆瓣代理可用', 'success'],
  [true, '测试失败，代理返回 502', 'error'],
])('代理测试失败=%s 时反馈对应文案和语气', async (fails, message, tone) => {
  if (fails) {
    jest
      .mocked(testCustomProxy)
      .mockRejectedValueOnce(new Error('代理返回 502'));
  }
  render(<SettingsPanel onClose={jest.fn()} />);
  selectCustomProxy();
  fireEvent.change(screen.getByLabelText('豆瓣代理地址'), {
    target: { value: 'https://proxy.example/?url=' },
  });
  jest.mocked(showToast).mockClear();
  fireEvent.click(screen.getByRole('button', { name: '测试' }));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(message, tone));
  expect(testCustomProxy).toHaveBeenCalledWith(
    'douban-data',
    'https://proxy.example/?url=',
  );
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
});

it('恢复默认仍需确认', () => {
  render(<SettingsPanel onClose={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
  expect(screen.getByRole('button', { name: '确认恢复' })).toBeInTheDocument();
  expect(showToast).not.toHaveBeenCalled();
});
