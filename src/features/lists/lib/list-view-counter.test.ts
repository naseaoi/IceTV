import { ListViewCounter } from './list-view-counter';

it('容量满时淘汰最旧项，重复访问不延长窗口', async () => {
  const counter = new ListViewCounter(1000, 2);
  const write = jest.fn(async () => {});
  const now = jest.spyOn(Date, 'now');
  try {
    now.mockReturnValue(0);
    expect(await counter.record('a', 'user:alice', write)).toBe(true);
    expect(await counter.record('b', 'user:alice', write)).toBe(true);
    now.mockReturnValue(500);
    expect(await counter.record('a', 'user:alice', write)).toBe(false);
    expect(await counter.record('c', 'user:alice', write)).toBe(true);
    expect(await counter.record('a', 'user:alice', write)).toBe(true);
    now.mockReturnValue(1500);
    expect(await counter.record('a', 'user:alice', write)).toBe(true);
    expect(write).toHaveBeenCalledTimes(5);
  } finally {
    now.mockRestore();
  }
});
it('并发访问只写一次，账号和游客前缀隔离', async () => {
  const counter = new ListViewCounter();
  let release!: () => void;
  const write = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = counter.record('list', 'user:alice', write);
  expect(await counter.record('list', 'user:alice', write)).toBe(false);
  release();
  expect(await first).toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
  expect(await counter.record('list', 'ip:alice', async () => {})).toBe(true);
});
it('写入失败释放占位，下一次请求可重试', async () => {
  const counter = new ListViewCounter();
  await expect(
    counter.record('list', 'user:alice', async () => {
      throw new Error('failed');
    }),
  ).rejects.toThrow('failed');
  expect(await counter.record('list', 'user:alice', async () => {})).toBe(true);
});
