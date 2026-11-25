import { removeStorage } from '@/lib/browser-storage';
import { reportSourcePlayOutcome } from '@/lib/source-route-stats.client';
import {
  readSourceWorkFailures,
  recordSourceWorkFailure,
  SOURCE_WORK_FAILURES_STORAGE_KEY,
  sourceWorkFailureKey,
} from '@/lib/source-work-failures';

import {
  createVodPlaybackIntent,
  isVodRouteNetworkError,
  reportVodPlaybackOutcome,
} from './vodPlaybackIntent';

jest.mock('@/lib/source-route-stats.client', () => ({
  reportSourcePlayOutcome: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  removeStorage(SOURCE_WORK_FAILURES_STORAGE_KEY);
});

test.each([
  'manifestLoadError',
  'levelLoadTimeOut',
  'keyLoadError',
  'fragLoadTimeOut',
])('网络加载失败 %s 可触发线路回落', (details) => {
  expect(isVodRouteNetworkError({ type: 'networkError', details })).toBe(true);
});
test.each([
  'fragLoadAborted',
  'bufferFullError',
  'manifestParsingError',
  'fragParsingError',
])('非线路错误 %s 不计线路失败', (details) => {
  expect(isVodRouteNetworkError({ type: 'networkError', details })).toBe(false);
});
test('离线与媒体错误不触发线路回落', () => {
  expect(
    isVodRouteNetworkError({ type: 'mediaError', details: 'fragLoadError' }),
  ).toBe(false);
  const offline = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  expect(
    isVodRouteNetworkError({
      type: 'networkError',
      details: 'manifestLoadError',
    }),
  ).toBe(false);
  offline.mockRestore();
});
test('每个源在一次播放意图中只上报一次，新意图独立计数', () => {
  const intent = createVodPlaybackIntent();
  reportVodPlaybackOutcome(intent, 'demo', true, '1');
  reportVodPlaybackOutcome(intent, 'demo', false, '1');
  expect(reportSourcePlayOutcome).toHaveBeenCalledTimes(1);
  expect(reportSourcePlayOutcome).toHaveBeenCalledWith('demo', true);
  reportVodPlaybackOutcome(createVodPlaybackIntent(), 'demo', false, '1');
  expect(reportSourcePlayOutcome).toHaveBeenCalledTimes(2);
  expect(readSourceWorkFailures()).toEqual(
    new Set([sourceWorkFailureKey('demo', '1')]),
  );
  reportVodPlaybackOutcome(createVodPlaybackIntent(), 'demo', true, '1');
  expect(readSourceWorkFailures().size).toBe(0);
});

test('offline outcomes neither add nor clear work failures', () => {
  recordSourceWorkFailure('demo', '1');
  const offline = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  reportVodPlaybackOutcome(createVodPlaybackIntent(), 'demo', true, '1');
  reportVodPlaybackOutcome(createVodPlaybackIntent(), 'other', false, '2');
  expect(readSourceWorkFailures()).toEqual(
    new Set([sourceWorkFailureKey('demo', '1')]),
  );
  expect(reportSourcePlayOutcome).not.toHaveBeenCalled();
  offline.mockRestore();
});
