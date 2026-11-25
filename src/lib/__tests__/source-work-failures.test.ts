import {
  readStorage,
  removeStorage,
  writeStorage,
} from '@/lib/browser-storage';
import {
  readSourceWorkFailures,
  recordSourceWorkFailure,
  recordSourceWorkSuccess,
  SOURCE_WORK_FAILURES_STORAGE_KEY,
  sourceWorkFailureKey,
} from '@/lib/source-work-failures';

const NOW = Date.UTC(2026, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  removeStorage(SOURCE_WORK_FAILURES_STORAGE_KEY);
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => jest.restoreAllMocks());

it('persists pairs independently, refreshes failures and expires at 24 hours', () => {
  recordSourceWorkFailure('a-b', 'c');
  recordSourceWorkFailure('a', 'b-c');
  expect(readSourceWorkFailures().size).toBe(2);
  expect(readSourceWorkFailures(NOW + DAY_MS - 1).size).toBe(2);
  jest.mocked(Date.now).mockReturnValue(NOW + 1);
  recordSourceWorkFailure('a-b', 'c');
  expect(readSourceWorkFailures(NOW + DAY_MS)).toEqual(
    new Set([sourceWorkFailureKey('a-b', 'c')]),
  );
  expect(readSourceWorkFailures(NOW + DAY_MS + 1).size).toBe(0);
});

it('evicts the oldest entries and keeps at most 200 in storage', () => {
  for (let index = 0; index < 202; index += 1) {
    jest.mocked(Date.now).mockReturnValue(NOW + index);
    recordSourceWorkFailure('source', String(index));
  }
  const failures = readSourceWorkFailures();
  expect(failures.size).toBe(200);
  expect(failures.has(sourceWorkFailureKey('source', '0'))).toBe(false);
  expect(failures.has(sourceWorkFailureKey('source', '1'))).toBe(false);
  expect(failures.has(sourceWorkFailureKey('source', '201'))).toBe(true);
  expect(
    JSON.parse(readStorage(SOURCE_WORK_FAILURES_STORAGE_KEY)!).entries,
  ).toHaveLength(200);
});

it('clears only the successful source and work pair', () => {
  recordSourceWorkFailure('a', '1');
  recordSourceWorkFailure('a', '2');
  recordSourceWorkFailure('b', '1');
  recordSourceWorkSuccess('a', '1');
  expect(readSourceWorkFailures()).toEqual(
    new Set([sourceWorkFailureKey('a', '2'), sourceWorkFailureKey('b', '1')]),
  );
});

it.each(['{', 'null', '[]', '{"v":2,"entries":[]}', '{"v":1,"entries":{}}'])(
  'ignores malformed or incompatible payload %s',
  (raw) => {
    writeStorage(SOURCE_WORK_FAILURES_STORAGE_KEY, raw);
    expect(readSourceWorkFailures().size).toBe(0);
    expect(() => recordSourceWorkFailure('a', '1')).not.toThrow();
    expect(readSourceWorkFailures().size).toBe(1);
  },
);

it('ignores invalid keys, timestamps and entries while preserving valid data', () => {
  const key = sourceWorkFailureKey('a', '1');
  writeStorage(
    SOURCE_WORK_FAILURES_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      entries: [
        null,
        [],
        ['broken', NOW],
        [JSON.stringify(['a', '']), NOW],
        [sourceWorkFailureKey('a'.repeat(65), '1'), NOW],
        [key, -1],
        [key, NOW + 1],
        [key, 'bad'],
        [key, null],
        [key, NOW - DAY_MS],
        [key, NOW],
      ],
    }),
  );
  expect(readSourceWorkFailures()).toEqual(new Set([key]));
  recordSourceWorkFailure('', '1');
  recordSourceWorkFailure('a', '');
  expect(readSourceWorkFailures()).toEqual(new Set([key]));
});

it('tolerates blocked reads and writes without affecting playback', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  expect(readSourceWorkFailures().size).toBe(0);
  expect(() => recordSourceWorkFailure('a', '1')).not.toThrow();
  expect(() => recordSourceWorkSuccess('a', '1')).not.toThrow();
});
