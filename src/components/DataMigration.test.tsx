import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { showToast } from '@/lib/toast';

import DataMigration from './DataMigration';

jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));

describe('DataMigration', () => {
  const originalFetch = global.fetch;
  const originalReload = window.location.reload;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('导出成功使用轻提示并清空密码', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn().mockReturnValue('blob:backup');
    URL.revokeObjectURL = jest.fn();
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      blob: async () => new Blob(['backup']),
    });
    try {
      render(<DataMigration />);
      fireEvent.change(screen.getByLabelText('加密密码'), {
        target: { value: 'backup-password' },
      });
      fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith(
          '导出成功，请妥善保管备份文件和密码',
          'success',
        ),
      );
      expect(screen.getByLabelText('加密密码')).toHaveValue('');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
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

  async function importWith(payload: Record<string, unknown>) {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        importedUsers: 1,
        timestamp: '2026-08-29T00:00:00.000Z',
        serverVersion: '0.4.10',
        ...payload,
      }),
    });

    render(<DataMigration />);

    fireEvent.change(screen.getByLabelText(/备份文件/), {
      target: {
        files: [
          new File(['backup'], 'backup.dat', {
            type: 'application/octet-stream',
          }),
        ],
      },
    });
    fireEvent.change(screen.getByLabelText(/解密密码/), {
      target: { value: 'strong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /导入数据/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    expect(await screen.findByText('导入成功')).toBeInTheDocument();
  }

  it('reports the owner remap in the success modal', async () => {
    await importWith({ ownerRemappedFrom: 'owner-a' });

    expect(screen.getByText(/原站站长 owner-a/)).toBeInTheDocument();
  });

  it('reports the site icon warning', async () => {
    await importWith({
      siteIconWarning: '备份未包含站点图标文件，请重新上传图标',
    });

    expect(
      screen.getByText('备份未包含站点图标文件，请重新上传图标'),
    ).toBeInTheDocument();
  });

  it('aggregates truncation reports by kind', async () => {
    await importWith({
      truncated: [
        { username: 'a', kind: 'searchHistory', dropped: 5 },
        { username: 'b', kind: 'searchHistory', dropped: 3 },
        { username: 'a', kind: 'playbackSessions', dropped: 10 },
      ],
    });

    expect(
      screen.getByText('搜索历史：2 个用户共 8 条超出上限被丢弃'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('观看统计：1 个用户共 10 条超出上限被丢弃'),
    ).toBeInTheDocument();
  });

  it('shows no truncation block when nothing was dropped', async () => {
    await importWith({ truncated: [] });

    expect(screen.queryByText(/超出上限被丢弃/)).not.toBeInTheDocument();
  });

  it('lists what the backup excludes', () => {
    render(<DataMigration />);

    expect(
      screen.getByText(/站长账号密码（由环境变量决定）/),
    ).toBeInTheDocument();
    expect(screen.getByText(/邀请码与用量/)).toBeInTheDocument();
    expect(screen.getByText(/站点图标/)).toBeInTheDocument();
  });
});
