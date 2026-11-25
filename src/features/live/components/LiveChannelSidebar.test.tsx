import { act, cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

import { groupLiveChannels } from '@/features/live/lib/liveChannelGroups';

import { LiveChannelSidebar } from './LiveChannelSidebar';

const channel = {
  id: 'cctv5',
  lineId: 'cctv5-line',
  tvgId: 'cctv5',
  name: 'CCTV5',
  logo: '',
  group: '央视',
  url: 'https://example.com/live.m3u8',
};

function renderEpg() {
  const props: ComponentProps<typeof LiveChannelSidebar> = {
    activeTab: 'epg',
    setActiveTab: jest.fn(),
    isSwitchingSource: false,
    groupedChannels: {},
    selectedGroup: '',
    filteredChannels: groupLiveChannels([channel]),
    currentChannel: channel,
    currentSource: null,
    liveSources: [],
    epgData: {
      tvgId: 'cctv5',
      source: 'live',
      epgUrl: '',
      programs: [
        {
          start: '2026-06-27T00:00:00Z',
          end: '2026-06-27T00:01:00Z',
          title: '节目一',
        },
        {
          start: '2026-06-27T00:01:00Z',
          end: '2026-06-27T00:02:00Z',
          title: '节目二',
        },
        {
          start: '2026-06-27T00:02:00Z',
          end: '2026-06-27T00:03:00Z',
          title: '节目三',
        },
      ],
    },
    isEpgLoading: false,
    searchQuery: '',
    onSearchChange: jest.fn(),
    favoriteReady: true,
    isGroupFavorited: () => false,
    toggleGroupFavorite: jest.fn(),
    groupContainerRef: { current: null },
    channelListRef: { current: null },
    handleGroupChange: jest.fn(),
    handleChannelChange: jest.fn(),
    handleSourceChange: jest.fn(),
  };
  const view = render(<LiveChannelSidebar {...props} />);
  view.container.querySelector<HTMLElement>(
    '[data-live-scroll-panel="epg"]',
  )!.scrollTo = jest.fn();
  return view;
}

function currentProgram() {
  return screen.queryByText('正在播放')?.parentElement;
}

describe('LiveChannelSidebar EPG', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-27T00:00:30Z'));
    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('每分钟更新当前节目，节目全部结束后移除正在播放标记', async () => {
    renderEpg();
    expect(currentProgram()).toHaveTextContent('节目一');
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(currentProgram()).toHaveTextContent('节目二');
    await act(async () => jest.advanceTimersByTime(120_000));
    expect(currentProgram()).toBeUndefined();
  });

  it('恢复可见立即校准时间，卸载时清理定时器与监听', async () => {
    const removeListener = jest.spyOn(document, 'removeEventListener');
    const setIntervalSpy = jest.spyOn(window, 'setInterval');
    const clearIntervalSpy = jest.spyOn(window, 'clearInterval');
    const { unmount } = renderEpg();
    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    jest.setSystemTime(new Date('2026-06-27T00:02:10Z'));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(currentProgram()).toHaveTextContent('节目一');
    jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(currentProgram()).toHaveTextContent('节目三');
    unmount();
    expect(removeListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(clearIntervalSpy).toHaveBeenCalledWith(
      setIntervalSpy.mock.results[0].value,
    );
  });

  it('用容器内坐标居中当前节目，与 offsetParent 的位置无关', async () => {
    const { container } = renderEpg();
    const list = container.querySelector<HTMLElement>(
      '[data-live-scroll-panel="epg"]',
    )!;
    const item = currentProgram()!;
    list.scrollTop = 150;
    jest
      .spyOn(list, 'getBoundingClientRect')
      .mockReturnValue({ top: 400, height: 300 } as DOMRect);
    jest
      .spyOn(item, 'getBoundingClientRect')
      .mockReturnValue({ top: 700, height: 60 } as DOMRect);
    Object.defineProperty(item, 'offsetTop', { value: 1200 });
    list.scrollTo = jest.fn();
    await act(async () => jest.advanceTimersByTime(80));
    expect(list.scrollTo).toHaveBeenCalledWith({
      top: 330,
      behavior: 'smooth',
    });
  });
});
