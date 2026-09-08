import { act, fireEvent, render, screen } from '@testing-library/react';

import { DanmakuTab } from '@/features/play/components/EpisodeSelector/DanmakuTab';
import {
  buildDanmakuScopeKey,
  readDanmakuOffset,
} from '@/lib/local-preferences';

jest.mock(
  '@/features/play/components/EpisodeSelector/DanmakuEpisodePicker',
  () => ({
    DanmakuEpisodePicker: () => <div>测试选集</div>,
  }),
);

const props = {
  source: 'test',
  videoId: 'video',
  episodeIndex: 0,
  searchTitle: '番剧',
};

describe('DanmakuTab reload controls', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reloads data explicitly and disables repeated clicks while pending', async () => {
    let finish!: () => void;
    const onReload = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<DanmakuTab {...props} onReload={onReload} />);
    const button = screen.getByRole('button', { name: '重载弹幕' });
    for (const name of ['弹幕偏移', '弹幕选集']) {
      expect(
        screen.getByRole('heading', { name, level: 3 }).firstElementChild,
      ).toHaveClass('w-[3px]', 'h-3.5');
    }
    expect(button).toHaveClass('h-7', 'text-xs', 'bg-transparent');
    fireEvent.click(button);
    expect(onReload).toHaveBeenCalledWith({ refreshData: true });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('svg')).toHaveClass('animate-spin');
    expect(button.querySelector('span')).toHaveClass('opacity-0');
    expect(button).toHaveTextContent('重载');
    fireEvent.click(button);
    expect(onReload).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('弹幕重载完成');
  });

  it('changes offsets without forcing another upstream request', () => {
    const onReload = jest.fn();
    render(<DanmakuTab {...props} onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: '延后 1 秒' }));
    expect(onReload).toHaveBeenCalledWith({ refreshData: false });
    expect(
      readDanmakuOffset(buildDanmakuScopeKey('test', 'video', 0) ?? ''),
    ).toBe(1);
  });

  it('keeps failed reloads recoverable', async () => {
    const onReload = jest.fn().mockRejectedValue(new Error('failed'));
    render(<DanmakuTab {...props} onReload={onReload} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重载弹幕' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      '弹幕重载失败，请稍后重试',
    );
    expect(screen.getByRole('button', { name: '重载弹幕' })).toBeEnabled();
  });

  it.each([
    [
      { status: 'loaded', count: 123 },
      '弹幕重载成功，已装载 123 条弹幕',
      'status',
    ],
    [{ status: 'empty' }, '弹幕重载完成，当前暂无弹幕', 'status'],
    [{ status: 'disabled' }, '弹幕已关闭，请先开启弹幕后重载', 'status'],
    [{ status: 'error' }, '弹幕重载失败，请稍后重试', 'alert'],
    [
      { status: 'rate-limited', retryAfterSeconds: 12 },
      '弹幕服务请求频繁，请 12 秒后重试',
      'alert',
    ],
  ])('reports the actual reload result %j', async (result, message, role) => {
    render(
      <DanmakuTab {...props} onReload={jest.fn().mockResolvedValue(result)} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重载弹幕' }));
    });
    expect(screen.getByRole(role as string)).toHaveTextContent(
      message as string,
    );
  });

  it('ignores a stale reload result after changing episodes', async () => {
    let finish!: () => void;
    const onReload = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = render(<DanmakuTab {...props} onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: '重载弹幕' }));
    rerender(<DanmakuTab {...props} episodeIndex={1} onReload={onReload} />);
    await act(async () => {
      finish();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重载弹幕' })).toBeEnabled();
  });
});
