import { act, fireEvent, render, screen } from '@testing-library/react';

import { SourcesTab } from '@/features/play/components/EpisodeSelector/SourcesTab';
import {
  getOrProbe,
  getSnapshot,
  holdBackgroundSourceProbes,
  releaseBackgroundSourceProbes,
  resetProbes,
} from '@/features/play/lib/sourceProbeStore';
import { probeVodEpisodeUrl } from '@/features/play/lib/vodProbe';
import type { SearchResult } from '@/lib/types';

jest.mock('@/features/play/lib/vodProbe', () => ({
  probeVodEpisodeUrl: jest.fn(),
}));
jest.mock('@/lib/proxy-modes', () => ({
  getProxyModes: jest.fn().mockResolvedValue({}),
  getSourcePlaybackRoute: jest.fn().mockReturnValue({
    useServerProxy: false,
    directManifest: true,
    allowAutoFallback: false,
  }),
}));
jest.mock('@/lib/source-route-stats.client', () => ({
  reportSourcePlayOutcome: jest.fn(),
  reportSourceRouteStat: jest.fn(),
}));

const source: SearchResult = {
  id: '1',
  source: 'candidate',
  source_name: '候选源',
  title: 'test',
  episodes: ['https://example.test/ep1.m3u8'],
  episodes_titles: ['1'],
  poster: '',
  year: '2026',
};
const info = { quality: '1080p', loadSpeed: '1 MB/s', pingTime: 20 };

function renderPanel() {
  return render(
    <SourcesTab
      availableSources={[source]}
      currentSource='playing'
      currentId='other'
      videoTitle='test'
      sourceSearchLoading={false}
      sourceSearchError={null}
      isActive
    />,
  );
}

const originalScrollTo = HTMLElement.prototype.scrollTo;
beforeAll(() => {
  HTMLElement.prototype.scrollTo = jest.fn();
});
afterAll(() => {
  HTMLElement.prototype.scrollTo = originalScrollTo;
});

beforeEach(() => {
  releaseBackgroundSourceProbes();
  resetProbes();
  jest.clearAllMocks();
  jest.mocked(probeVodEpisodeUrl).mockResolvedValue(info);
});
afterEach(() => releaseBackgroundSourceProbes());

it('起播期间打开面板只排队，显式检测全部可立即执行', async () => {
  holdBackgroundSourceProbes();
  renderPanel();
  expect(getSnapshot().get('candidate-1')?.source).toBe('queued');
  expect(screen.queryByText('检测中')).toBeNull();
  expect(probeVodEpisodeUrl).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: '检测全部' })),
  );
  expect(probeVodEpisodeUrl).toHaveBeenCalledTimes(1);
  expect(getSnapshot().get('candidate-1')?.source).toBe('probe');
});

it('暂缓期间切到候选源后，排队测速不会再请求当前源', async () => {
  holdBackgroundSourceProbes();
  const view = renderPanel();
  view.rerender(
    <SourcesTab
      availableSources={[source]}
      currentSource={source.source}
      currentId={source.id}
      videoTitle='test'
      sourceSearchLoading={false}
      sourceSearchError={null}
      isActive
    />,
  );
  await act(async () => releaseBackgroundSourceProbes());
  expect(probeVodEpisodeUrl).not.toHaveBeenCalled();
});

it('初始化目标集在途时打开面板不重复下载，沿用源级测速', async () => {
  let finish!: (value: typeof info) => void;
  const probe = jest.fn(
    () =>
      new Promise<typeof info>((resolve) => {
        finish = resolve;
      }),
  );
  const task = getOrProbe(source, {
    foreground: true,
    probeIdentity: 'ep2',
    probe,
  });
  await Promise.resolve();
  renderPanel();
  expect(screen.getByText('检测中')).toBeInTheDocument();
  expect(probeVodEpisodeUrl).not.toHaveBeenCalled();
  await act(async () => {
    finish(info);
    await task;
  });
  expect(probe).toHaveBeenCalledTimes(1);
  expect(probeVodEpisodeUrl).not.toHaveBeenCalled();
  expect(screen.getByText('1 MB/s')).toBeInTheDocument();
});
