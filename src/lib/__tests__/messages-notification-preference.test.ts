import { readStorage, writeStorage } from '@/lib/browser-storage';
import {
  readNotifiedMessageAt,
  writeNotifiedMessageAt,
} from '@/lib/message-notification-preference';

jest.mock('@/lib/browser-storage', () => ({
  readStorage: jest.fn(),
  writeStorage: jest.fn(),
}));

beforeEach(() => jest.resetAllMocks());

it('按规范账号隔离提醒水位并单调写入', () => {
  jest.mocked(readStorage).mockReturnValue('2000');
  jest.mocked(writeStorage).mockReturnValue(true);
  expect(readNotifiedMessageAt(' Demo ')).toBe(2000);
  expect(writeNotifiedMessageAt('demo', 1000)).toBe(true);
  expect(writeStorage).toHaveBeenCalledWith(
    'messages_notified_at:demo',
    '2000',
  );
  writeNotifiedMessageAt('other', 3000);
  expect(writeStorage).toHaveBeenLastCalledWith(
    'messages_notified_at:other',
    '3000',
  );
});

it.each([null, '-1', 'NaN', 'Infinity', '1.5', 'invalid'])(
  '无效缓存 %s 视为初始水位',
  (value) => {
    jest.mocked(readStorage).mockReturnValue(value);
    expect(readNotifiedMessageAt('demo')).toBe(0);
  },
);

it('返回存储失败且拒绝无效时间', () => {
  jest.mocked(readStorage).mockReturnValue(null);
  jest.mocked(writeStorage).mockReturnValue(false);
  expect(writeNotifiedMessageAt('demo', 1000)).toBe(false);
  expect(writeNotifiedMessageAt('demo', NaN)).toBe(false);
  expect(writeStorage).toHaveBeenCalledTimes(1);
});
