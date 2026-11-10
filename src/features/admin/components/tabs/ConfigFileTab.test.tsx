import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ConfigFileTab from '@/features/admin/components/tabs/ConfigFileTab';
import { adminPost } from '@/features/admin/lib/api';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

jest.mock('@/components/modals/AlertModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/features/admin/lib/api', () => ({
  adminPost: jest.fn(),
}));

jest.mock('@/hooks/useAlertModal', () => ({
  useAlertModal: () => ({
    alertModal: { isOpen: false, type: 'success', title: '' },
    showAlert: jest.fn(),
    hideAlert: jest.fn(),
  }),
}));

jest.mock('@/features/admin/hooks/useLoadingState', () => ({
  useLoadingState: () => ({
    isLoading: () => false,
    withLoading: async (_key: string, action: () => Promise<unknown>) =>
      action(),
  }),
}));

jest.mock('@/lib/config-file-json', () => ({
  buildConfigFileFromAdminConfig: () => '{"sites":[]}',
}));

describe('ConfigFileTab', () => {
  const config = {
    ConfigSubscribtion: { URL: '', AutoUpdate: false, LastCheck: '' },
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('imports JSON into the draft without saving it immediately', async () => {
    const onDirtyChange = jest.fn();
    const { container } = render(
      <ConfigFileTab
        config={config}
        refreshConfig={jest.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    const content = '{"sites":[{"key":"demo"}]}';
    const file = new File([content], 'config.json', {
      type: 'application/json',
    });
    Object.defineProperty(file, 'text', {
      value: jest.fn().mockResolvedValue(content),
    });

    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    const input = container.querySelector<HTMLInputElement>(
      '#config-file-import',
    );
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '配置文件内容' })).toHaveValue(
        content,
      );
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(adminPost).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: '保存' }),
    ).not.toBeInTheDocument();
  });
});

it.each([
  ['large', 'JSON 文件不能超过 2MB'],
  ['read', '读取文件失败，请重试'],
  ['format', 'JSON 文件格式错误'],
])('导入 %s 失败保留草稿', async (kind, message) => {
  const { container } = render(
    <ConfigFileTab
      config={{ ConfigSubscribtion: {} } as never}
      refreshConfig={jest.fn()}
    />,
  );
  const file = new File(['{}'], 'test.json');
  Object.defineProperty(file, 'text', {
    value:
      kind === 'read'
        ? jest.fn().mockRejectedValue(new Error('disk'))
        : jest.fn().mockResolvedValue('{'),
  });
  if (kind === 'large')
    Object.defineProperty(file, 'size', { value: 2 * 1024 * 1024 + 1 });
  fireEvent.change(container.querySelector('#config-file-import')!, {
    target: { files: [file] },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('textbox', { name: '配置文件内容' })).toHaveValue(
    '{"sites":[]}',
  );
});

it('读取中禁用导入且忽略第二次选择', async () => {
  const { container } = render(
    <ConfigFileTab
      config={{ ConfigSubscribtion: {} } as never}
      refreshConfig={jest.fn()}
    />,
  );
  let resolve!: (text: string) => void;
  const file = new File(['{}'], 'test.json');
  Object.defineProperty(file, 'text', {
    value: jest.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    ),
  });
  const second = new File(['{}'], 'second.json');
  const secondRead = jest.fn().mockResolvedValue('{}');
  Object.defineProperty(second, 'text', { value: secondRead });
  const input = container.querySelector('#config-file-import')!;
  fireEvent.change(input, { target: { files: [file] } });
  expect(screen.getByRole('button', { name: '读取中...' })).toBeDisabled();
  fireEvent.change(input, { target: { files: [second] } });
  expect(secondRead).not.toHaveBeenCalled();
  resolve('{"first":true}');
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: '配置文件内容' })).toHaveValue(
      '{"first":true}',
    ),
  );
});
