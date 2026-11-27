import { recordSourcePlaybackSmoothness } from '@/lib/source-playback-stats';
import {
  flushSourceRouteReports,
  reportSourceSmoothness,
} from '@/lib/source-route-stats.client';

import {
  type PlaybackSmoothnessContext,
  createPlaybackSmoothnessReporter,
} from './playbackSmoothnessReporter';

jest.mock('@/lib/source-playback-stats', () => ({
  recordSourcePlaybackSmoothness: jest.fn(),
}));
jest.mock('@/lib/source-route-stats.client', () => ({
  reportSourceSmoothness: jest.fn(),
  flushSourceRouteReports: jest.fn(),
}));

let context: PlaybackSmoothnessContext | null;
let reporter: ReturnType<typeof createPlaybackSmoothnessReporter>;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  context = {
    sessionKey: 'source:work:episode',
    key: 'source:work:episode:browser',
    source: 'source',
    routeMode: 'browser',
    mediaType: 'hls',
    snapshot: {
      currentTime: 0,
      forwardBuffer: 0,
      paused: false,
      visible: true,
      online: true,
      seeking: false,
      resourceWaiting: false,
    },
  };
  reporter = createPlaybackSmoothnessReporter(() =>
    context ? { ...context, snapshot: { ...context.snapshot } } : null,
  );
});
afterEach(() => {
  reporter.dispose();
  jest.useRealTimers();
});
function start() {
  reporter.handle('playing');
  context!.snapshot.currentTime += 0.1;
  reporter.handle('timeupdate');
}

it('每六十秒上报增量，暂停补报且本地记忆只在段结束时更新', () => {
  start();
  jest.advanceTimersByTime(60_000);
  expect(reportSourceSmoothness).toHaveBeenLastCalledWith(
    expect.objectContaining({
      watchMs: 60_000,
      routeMode: 'browser',
      mediaType: 'hls',
    }),
  );
  jest.advanceTimersByTime(2_000);
  context!.snapshot.paused = true;
  reporter.handle('pause');
  expect(reportSourceSmoothness).toHaveBeenLastCalledWith(
    expect.objectContaining({ watchMs: 2_000 }),
  );
  expect(recordSourcePlaybackSmoothness).not.toHaveBeenCalled();
  reporter.finish();
  expect(recordSourcePlaybackSmoothness).toHaveBeenCalledWith(
    'source',
    expect.objectContaining({ watchMs: 62_000 }),
  );
});

it('线路回落结束旧段，新段重走起播门禁，按新线路/媒体类型上报', () => {
  start();
  jest.advanceTimersByTime(5_000);
  reporter.endSegment();
  context = {
    ...context!,
    key: 'source:work:episode:server',
    routeMode: 'server',
    mediaType: 'mp4',
  };
  reporter.handle('waiting');
  jest.advanceTimersByTime(10_000);
  start();
  jest.advanceTimersByTime(2_000);
  reporter.finish();
  expect(reportSourceSmoothness).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      watchMs: 5_000,
      routeMode: 'browser',
      mediaType: 'hls',
    }),
  );
  expect(reportSourceSmoothness).toHaveBeenLastCalledWith(
    expect.objectContaining({
      watchMs: 2_000,
      routeMode: 'server',
      mediaType: 'mp4',
      stallCount: 0,
    }),
  );
  expect(recordSourcePlaybackSmoothness).toHaveBeenCalledTimes(1);
  expect(recordSourcePlaybackSmoothness).toHaveBeenCalledWith(
    'source',
    expect.objectContaining({ watchMs: 7_000 }),
  );
});

it('源/作品/集身份改变只结算旧段，释放和销毁保持幂等', () => {
  start();
  jest.advanceTimersByTime(2_000);
  context = {
    ...context!,
    sessionKey: 'another-source:another-work:next',
    key: 'another-source:another-work:next',
    source: 'next',
  };
  reporter.handle('timeupdate');
  start();
  jest.advanceTimersByTime(2_000);
  context = null;
  reporter.handle('tick');
  reporter.finish();
  reporter.dispose();
  expect(recordSourcePlaybackSmoothness).toHaveBeenCalledTimes(2);
  expect(reportSourceSmoothness).toHaveBeenLastCalledWith(
    expect.objectContaining({ source: 'next', watchMs: 2_000 }),
  );
});

it('隐藏补报并立即 flush，pagehide 结算进行中的卡顿', () => {
  start();
  jest.advanceTimersByTime(2_000);
  context!.snapshot.visible = false;
  const visibility = jest
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(reportSourceSmoothness).toHaveBeenLastCalledWith(
    expect.objectContaining({ watchMs: 2_000 }),
  );
  expect(flushSourceRouteReports).toHaveBeenCalledTimes(1);
  visibility.mockRestore();
  context!.snapshot.visible = true;
  reporter.handle('playing');
  reporter.handle('waiting');
  jest.advanceTimersByTime(1_500);
  window.dispatchEvent(new Event('pagehide'));
  expect(recordSourcePlaybackSmoothness).toHaveBeenLastCalledWith(
    'source',
    expect.objectContaining({ stallCount: 1, stallMs: 1_500 }),
  );
  expect(flushSourceRouteReports).toHaveBeenCalledTimes(2);
});
