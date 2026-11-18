import { findLatestPlayRecordKeyByTitle } from '@/lib/play-record-title';

it('最近 500 条轻量投影扫描到上限停止', async () => {
  const read = jest.fn(async () =>
    Array.from({ length: 100 }, (_, index) => ({
      record_key: `a+${index}`,
      title: '其他',
      year: '2024',
    })),
  );
  expect(await findLatestPlayRecordKeyByTitle('目标', '2024', read)).toBeNull();
  expect(read).toHaveBeenCalledTimes(5);
  expect(read).toHaveBeenLastCalledWith(400, 100);
});

it('按分页顺序命中即停，年份缺失不混入指定年份', async () => {
  const read = jest.fn(async () => [
    { record_key: 'a+1', title: 'Ａ·Ｂ', year: '' },
    { record_key: 'a+2', title: 'a b', year: '2024' },
  ]);
  expect(await findLatestPlayRecordKeyByTitle('AB', '2024', read)).toBe('a+2');
  expect(read).toHaveBeenCalledTimes(1);
});
