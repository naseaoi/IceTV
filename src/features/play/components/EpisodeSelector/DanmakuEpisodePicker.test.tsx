import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { DanmakuEpisodePicker } from '@/features/play/components/EpisodeSelector/DanmakuEpisodePicker';
import {
  clearPersistedEpisodeId,
  getPersistedEpisodeId,
  persistEpisodeId,
} from '@/features/play/lib/danmaku/episode-storage';
import type { DanmakuMatchCandidate } from '@/features/play/lib/danmaku/types';

jest.mock('@/features/play/lib/danmaku/episode-storage', () => ({
  clearPersistedEpisodeId: jest.fn(),
  getPersistedEpisodeId: jest.fn(),
  persistEpisodeId: jest.fn(),
}));

const candidates: DanmakuMatchCandidate[] = Array.from(
  { length: 12 },
  (_source, sourceIndex) =>
    Array.from({ length: 8 }, (_episode, episodeIndex) => ({
      episodeId: sourceIndex * 100 + episodeIndex + 1,
      animeTitle: `番剧 from source-${sourceIndex}`,
      episodeTitle: `第${episodeIndex + 1}集`,
    })),
).flat();
const props = {
  source: 'test',
  videoId: 'video',
  episodeIndex: 0,
  searchTitle: '番剧',
};
const originalFetch = global.fetch;
const originalResizeObserver = global.ResizeObserver;
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollTo',
);
let listHeight: number;
let resizeList: () => void;

function getList() {
  return document.querySelector<HTMLElement>('[data-top-fade]')!;
}

function scrollList(top: number) {
  const list = getList();
  list.scrollTop = top;
  fireEvent.scroll(list);
}

async function showSourceList() {
  const onBindingChange = jest.fn();
  render(<DanmakuEpisodePicker {...props} onBindingChange={onBindingChange} />);
  fireEvent.click(await screen.findByRole('button', { name: '返回源列表' }));
  return { onBindingChange };
}

beforeEach(() => {
  jest.clearAllMocks();
  listHeight = 120;
  (getPersistedEpisodeId as jest.Mock).mockResolvedValue(606);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: [...candidates], hasMore: true }),
  });
  global.ResizeObserver = jest.fn().mockImplementation((callback) => {
    resizeList = () => callback([], {});
    return { observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() };
  });
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  jest
    .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.matches('[data-top-fade]') ? listHeight : 40;
    });
  jest
    .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.children.length * 40;
    });
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const list = this.parentElement;
      const top = list?.matches('[data-top-fade]')
        ? Array.from(list.children).indexOf(this) * 40 - list.scrollTop
        : 0;
      const height = this.matches('[data-top-fade]') ? listHeight : 40;
      return { top, bottom: top + height, height } as DOMRect;
    });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: jest.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0;
      this.dispatchEvent(new Event('scroll'));
    }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = originalFetch;
  global.ResizeObserver = originalResizeObserver;
  if (originalScrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  }
});

it('返回源列表时定位当前绑定源，不重新展开选集', async () => {
  await showSourceList();

  expect(screen.getByRole('button', { name: /当前绑定/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  expect(getList().scrollTop).toBe(200);
  expect(screen.queryByRole('button', { name: '返回源列表' })).toBeNull();
  expect(screen.queryByRole('button', { name: '回到当前弹幕源' })).toBeNull();
});

it.each([0, 400])('滚动到 %s 后可回到当前源，且不修改绑定', async (top) => {
  const { onBindingChange } = await showSourceList();
  scrollList(top);

  fireEvent.click(screen.getByRole('button', { name: '回到当前弹幕源' }));

  expect(getList().scrollTop).toBe(200);
  expect(getList().scrollTo).toHaveBeenLastCalledWith({
    top: 200,
    behavior: 'smooth',
  });
  expect(screen.queryByRole('button', { name: '回到当前弹幕源' })).toBeNull();
  expect(screen.queryByRole('button', { name: '返回源列表' })).toBeNull();
  expect(persistEpisodeId).not.toHaveBeenCalled();
  expect(onBindingChange).not.toHaveBeenCalled();
});

it('打开当前源后保留已绑定弹幕集的定位', async () => {
  await showSourceList();
  fireEvent.click(screen.getByRole('button', { name: /当前绑定/ }));
  scrollList(0);

  fireEvent.click(screen.getByRole('button', { name: '回到已绑定弹幕集' }));

  expect(getList().scrollTop).toBe(160);
  expect(screen.getByRole('button', { name: '第6集 ID: 606' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('浏览其他源时不残留当前源定位按钮', async () => {
  await showSourceList();
  scrollList(0);
  fireEvent.click(screen.getByRole('button', { name: 'source-1 番剧 8 集' }));
  scrollList(200);

  expect(screen.queryByRole('button', { name: /回到.*弹幕/ })).toBeNull();
});

it('列表尺寸改变时同步定位按钮显隐', async () => {
  await showSourceList();
  listHeight = 20;
  fireEvent(window, new Event('resize'));
  expect(screen.getByRole('button', { name: '回到当前弹幕源' })).toBeVisible();

  listHeight = 120;
  act(() => resizeList());
  expect(screen.queryByRole('button', { name: '回到当前弹幕源' })).toBeNull();
});

it('重新搜索后仍自动展开当前绑定源', async () => {
  await showSourceList();
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));

  await screen.findByRole('button', { name: '返回源列表' });
  expect(screen.getByRole('button', { name: '第6集 ID: 606' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

it('加载更多候选不会抢走用户的滚动位置', async () => {
  await showSourceList();
  scrollList(0);
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      candidates: [
        { episodeId: 9999, animeTitle: '追加源', episodeTitle: '1' },
      ],
      hasMore: false,
    }),
  });
  fireEvent.click(screen.getByRole('button', { name: '加载更多候选' }));

  await screen.findByRole('button', { name: '追加源 1 集' });
  expect(getList().scrollTop).toBe(0);
  expect(screen.getByRole('button', { name: '回到当前弹幕源' })).toBeVisible();
});

it('清除绑定后隐藏定位按钮', async () => {
  await showSourceList();
  scrollList(0);
  fireEvent.click(screen.getByRole('button', { name: '清除绑定' }));

  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '回到当前弹幕源' })).toBeNull(),
  );
  expect(clearPersistedEpisodeId).toHaveBeenCalledWith('test', 'video', 0);
});

it.each([null, 99999])(
  '绑定 %s 不在候选内时不显示定位按钮',
  async (episodeId) => {
    (getPersistedEpisodeId as jest.Mock).mockResolvedValue(episodeId);
    render(<DanmakuEpisodePicker {...props} />);
    await screen.findByRole('button', { name: /source-0/ });
    scrollList(200);

    expect(screen.queryByRole('button', { name: /回到.*弹幕/ })).toBeNull();
  },
);
