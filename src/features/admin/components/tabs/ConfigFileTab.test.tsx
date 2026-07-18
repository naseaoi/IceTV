import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ConfigFileTab from '@/features/admin/components/tabs/ConfigFileTab';
import { adminPost } from '@/features/admin/lib/api';

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
    expect(
      screen.queryByRole('button', { name: '保存' }),
    ).not.toBeInTheDocument();
  });
});
