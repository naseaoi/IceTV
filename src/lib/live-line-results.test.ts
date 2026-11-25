import { removeStorage, writeStorage } from './browser-storage';
import {
  LIVE_LINE_RESULT_TTL_MS,
  LIVE_LINE_RESULTS_STORAGE_KEY,
  readLiveLineResults,
  recordLiveLineResult,
} from './live-line-results';

beforeEach(() => removeStorage(LIVE_LINE_RESULTS_STORAGE_KEY));
it('30 分钟到期，成功覆盖失败，缺少 lineId 时跳过', () => {
  recordLiveLineResult('a', false, 1000);
  recordLiveLineResult('a', true, 2000);
  recordLiveLineResult('', false, 2000);
  expect([...readLiveLineResults(2000)]).toEqual([
    ['a', { ok: true, at: 2000 }],
  ]);
  expect(readLiveLineResults(2000 + LIVE_LINE_RESULT_TTL_MS).size).toBe(0);
});
it('过滤损坏、未来与过期记录，最多保留最新 500 条', () => {
  writeStorage(
    LIVE_LINE_RESULTS_STORAGE_KEY,
    JSON.stringify([
      ['future', { ok: true, at: 100 }],
      ['bad', { ok: 1, at: 5 }],
      ...Array.from({ length: 510 }, (_, index) => [
        `line${index}`,
        { ok: true, at: index },
      ]),
    ]),
  );
  expect(readLiveLineResults(50).has('future')).toBe(false);
  expect(readLiveLineResults(1000).has('bad')).toBe(false);
  recordLiveLineResult('new', true, 1000);
  expect(readLiveLineResults(1000).size).toBe(500);
  expect(readLiveLineResults(1000).has('new')).toBe(true);
  expect(readLiveLineResults(1000).has('line0')).toBe(false);
});
