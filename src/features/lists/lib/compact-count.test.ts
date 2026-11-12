import { formatCompactCount } from './compact-count';

it('万以下原样显示，以上换算为万并保留至多一位小数', () => {
  expect(formatCompactCount(0)).toBe('0');
  expect(formatCompactCount(9999)).toBe('9999');
  expect(formatCompactCount(10000)).toBe('1万');
  expect(formatCompactCount(12345)).toBe('1.2万');
  expect(formatCompactCount(1234567)).toBe('123万');
});
