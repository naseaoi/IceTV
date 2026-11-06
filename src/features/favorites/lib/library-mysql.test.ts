/** @jest-environment node */
import { MySqlStorage } from '@/lib/mysql.db';
import type { Favorite } from '@/lib/types';

const favorite: Favorite = {
  title: 'Demo',
  year: '2026',
  source_name: '豆瓣',
  total_episodes: 0,
  cover: '',
  save_time: 100,
  watch_status: 'completed',
  watched_at: 50,
};

function createStorage() {
  const connection = {
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
    query: jest.fn(async (sql: string) =>
      sql.includes('FROM favorites')
        ? [
            [
              {
                favorite_key: 'douban+1',
                favorite_json: JSON.stringify(favorite),
              },
            ],
          ]
        : [[]],
    ),
    execute: jest.fn().mockResolvedValue([{ affectedRows: 1 }]),
  };
  // 此处只验证事务接线与投影参数；SQL 谓词由真实数据库契约测试验证。
  const storage = Object.create(MySqlStorage.prototype) as MySqlStorage;
  Object.assign(storage, {
    initPromise: Promise.resolve(),
    pool: { getConnection: async () => connection },
  });
  jest
    .spyOn(storage, 'ensureUserProfile')
    .mockResolvedValue(
      {} as Awaited<ReturnType<MySqlStorage['ensureUserProfile']>>,
    );
  return { storage, connection };
}

it('MySQL 合并在同一事务写入 JSON/投影并删除目录项', async () => {
  const { storage, connection } = createStorage();
  expect(
    await storage.saveMergedFavorite('demo', 'source+1', {
      ...favorite,
      watch_status: undefined,
      watched_at: undefined,
    }),
  ).toBe('source+1');
  const write = connection.execute.mock.calls[0];
  expect(write[0]).toContain('watch_status, watched_at, projection_version');
  expect(write[1].slice(-3)).toEqual(['completed', 50, 2]);
  expect(connection.execute).toHaveBeenLastCalledWith(
    'DELETE FROM favorites WHERE username = ? AND favorite_key = ?',
    ['demo', 'douban+1'],
  );
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
});

it('MySQL 批量失败回滚且释放连接', async () => {
  const { storage, connection } = createStorage();
  connection.execute.mockRejectedValueOnce(new Error('write failed'));
  await expect(
    storage.batchFavorites('demo', {
      action: 'set-status',
      target: { keys: ['douban+1'] },
      watchStatus: 'planned',
    }),
  ).rejects.toThrow('write failed');
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});

it('MySQL 批量恢复自动状态同事务清空 JSON 与投影字段', async () => {
  const { storage, connection } = createStorage();
  expect(
    await storage.batchFavorites('demo', {
      action: 'set-status',
      target: { keys: ['douban+1'] },
      watchStatus: null,
    }),
  ).toEqual({ affected: 1 });
  const params = connection.execute.mock.calls[0][1];
  expect(JSON.parse(params[0]).watch_status).toBeUndefined();
  expect(JSON.parse(params[0]).watched_at).toBeUndefined();
  expect(params.slice(-5)).toEqual([null, null, 2, 'demo', 'douban+1']);
  expect(
    connection.query.mock.calls.some(([sql]) => sql.endsWith('FOR UPDATE')),
  ).toBe(true);
});
