import {
  clearListCountCookie,
  clearListCountCookiesOnResponse,
  LIST_COUNT_COOKIE_NAMES,
  parseListCountCookie,
  readListCountCookie,
  writeListCountCookie,
} from '@/lib/list-count-cookies';

afterEach(() => {
  for (const name of LIST_COUNT_COOKIE_NAMES) clearListCountCookie(name);
});

it.each([
  [undefined, null],
  ['', null],
  ['abc', null],
  ['-3', 0],
  ['6.8', 6],
])('解析计数 %p 为 %p', (raw, expected) => {
  expect(parseListCountCookie(raw)).toBe(expected);
});

it('写入后可读回，未写入的计数视为未知', () => {
  writeListCountCookie('review_count', 3);
  expect(readListCountCookie('review_count')).toBe(3);
  expect(readListCountCookie('history_count')).toBeNull();
  writeListCountCookie('history_count', 0);
  expect(readListCountCookie('history_count')).toBe(0);
});

it('登录与退出时过期全部计数 cookie', () => {
  const set = jest.fn();
  clearListCountCookiesOnResponse({ cookies: { set } } as never);
  expect(set.mock.calls.map(([name]) => name).sort()).toEqual(
    [...LIST_COUNT_COOKIE_NAMES].sort(),
  );
  for (const [, value, options] of set.mock.calls) {
    expect(value).toBe('');
    expect(options.expires.getTime()).toBe(0);
  }
});
