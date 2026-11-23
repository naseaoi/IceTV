import PlayTargetPage from '@/app/play/[source]/[id]/page';
import { getInitialDanmakuEnabled } from '@/features/play/lib/danmaku/preference.server';
import { getConfigForRead } from '@/lib/config';

import PlayPage from './page';

jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

jest.mock('next/server', () => ({
  connection: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/config', () => ({ getConfigForRead: jest.fn() }));
jest.mock('@/features/play/lib/danmaku/preference.server', () => ({
  getInitialDanmakuEnabled: jest.fn(),
}));
jest.mock('@/features/play/PlayPageClient', () => ({
  PlayPageClient: () => null,
}));
jest.mock('@/features/play/components/PlayStateViews', () => ({
  PlayLoadingView: () => null,
}));

beforeEach(() => jest.clearAllMocks());

test.each([false, true])(
  '播放路径与查询入口遵守成人源开关 (%s)',
  async (allowed) => {
    (getConfigForRead as jest.Mock).mockResolvedValue({
      SourceConfig: [{ key: 'adult', nsfw: true }],
      SiteConfig: { EnableDanmaku: false, DisableYellowFilter: allowed },
    });
    const requests = [
      () => PlayPage({ searchParams: Promise.resolve({ source: 'adult' }) }),
      () =>
        PlayTargetPage({
          params: Promise.resolve({ source: 'adult', id: '1' }),
        }),
    ];
    for (const request of requests) {
      if (allowed) await expect(request()).resolves.toBeDefined();
      else await expect(request()).rejects.toThrow('NOT_FOUND');
    }
  },
);

test('站点关闭弹幕时跳过账号偏好读取', async () => {
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SiteConfig: { EnableDanmaku: false },
  });
  const page = await PlayPage();
  expect(getInitialDanmakuEnabled).not.toHaveBeenCalled();
  expect(page.props.children.props.initialDanmakuEnabled).toBeNull();
});

test('站点启用时等待账号真值后再返回客户端', async () => {
  (getConfigForRead as jest.Mock).mockResolvedValue({
    SiteConfig: { EnableDanmaku: true },
  });
  let finish!: (value: boolean) => void;
  (getInitialDanmakuEnabled as jest.Mock).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let returned = false;
  const task = PlayPage().then((page) => {
    returned = true;
    return page;
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(returned).toBe(false);
  finish(false);
  expect((await task).props.children.props.initialDanmakuEnabled).toBe(false);
});
