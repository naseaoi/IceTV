import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import DataMigration from './DataMigration';

describe('DataMigration', () => {
  const originalFetch = global.fetch;
  const originalReload = window.location.reload;

  beforeEach(() => {
    global.fetch = jest.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        reload: jest.fn(),
      },
    });
    window.requestAnimationFrame = (callback) => {
      callback(0);
      return 0;
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        reload: originalReload,
      },
    });
    jest.restoreAllMocks();
  });

  it('renders imported metadata as text in the success modal', async () => {
    const maliciousVersion = '<img src=x onerror=alert(1)>';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        importedUsers: 2,
        timestamp: '2026-07-06T12:00:00.000Z',
        serverVersion: maliciousVersion,
      }),
    });

    render(<DataMigration />);

    const file = new File(['backup'], 'backup.dat', {
      type: 'application/octet-stream',
    });
    fireEvent.change(screen.getByLabelText(/备份文件/), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText(/解密密码/), {
      target: { value: 'strong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /导入数据/ }));
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    expect(await screen.findByText('导入成功')).toBeInTheDocument();
    expect(
      screen.getByText(`服务器版本: ${maliciousVersion}`),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(document.querySelector('img[src="x"]')).not.toBeInTheDocument();
    });
  });
});
