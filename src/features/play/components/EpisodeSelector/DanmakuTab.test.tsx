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
    const button = screen.getByRole('button', { name: '重新加载弹幕' });
    fireEvent.click(button);
    expect(onReload).toHaveBeenCalledWith({ refreshData: true });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onReload).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
    });
    expect(button).toBeEnabled();
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
      fireEvent.click(screen.getByRole('button', { name: '重新加载弹幕' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      '重新加载失败，请稍后再试',
    );
    expect(screen.getByRole('button', { name: '重新加载弹幕' })).toBeEnabled();
  });
});
