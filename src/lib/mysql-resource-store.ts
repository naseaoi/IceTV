import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';

import {
  type ResourceLeaseAdmission,
  type ResourceLeaseLimit,
  type SharedResourceStore,
  pruneResourceBatches,
} from '@/lib/shared-resource-store';

export class MySqlResourceStore implements SharedResourceStore {
  constructor(
    private readonly pool: Pool,
    private readonly initialize: () => Promise<void>,
  ) {}

  private async transaction<T>(
    task: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    await this.initialize();
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await task(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getCooldown(key: string): Promise<number> {
    await this.initialize();
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT reset_at FROM shared_resource_usage WHERE resource_key = ?',
      [key],
    );
    return Number(rows[0]?.reset_at ?? 0);
  }

  async extendCooldown(key: string, until: number): Promise<number> {
    return this.transaction(async (connection) => {
      await connection.execute(
        'INSERT INTO shared_resource_usage (resource_key, used, reset_at) VALUES (?, 0, ?) ON DUPLICATE KEY UPDATE reset_at = GREATEST(reset_at, ?)',
        [key, until, until],
      );
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT reset_at FROM shared_resource_usage WHERE resource_key = ? FOR UPDATE',
        [key],
      );
      return Number(rows[0].reset_at);
    });
  }

  async consume(
    key: string,
    amount: number,
    limit: number,
    windowMs: number,
    now: number,
  ) {
    return this.transaction(async (connection) => {
      await connection.execute(
        'INSERT INTO shared_resource_usage (resource_key, used, reset_at) VALUES (?, 0, ?) ON DUPLICATE KEY UPDATE resource_key = resource_key',
        [key, now + windowMs],
      );
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT used, reset_at FROM shared_resource_usage WHERE resource_key = ? FOR UPDATE',
        [key],
      );
      const used = Number(rows[0].reset_at) <= now ? 0 : Number(rows[0].used);
      const resetAt =
        Number(rows[0].reset_at) <= now
          ? now + windowMs
          : Number(rows[0].reset_at);
      const allowed = used + amount <= limit;
      if (allowed)
        await connection.execute(
          'UPDATE shared_resource_usage SET used = ?, reset_at = ? WHERE resource_key = ?',
          [used + amount, resetAt, key],
        );
      return { allowed, retryAfterMs: Math.max(1, resetAt - now) };
    });
  }

  async acquireLeases(
    resources: readonly ResourceLeaseLimit[],
    token: string,
    now: number,
    until: number,
  ): Promise<ResourceLeaseAdmission> {
    const keys = [...new Set(resources.map(({ key }) => key))].sort();
    if (!keys.length) return { allowed: true };
    const placeholders = keys.map(() => '?').join(', ');
    return this.transaction(async (connection) => {
      // 多行插入本身就会加锁，须与后续锁定语句保持同一主键顺序。
      await connection.execute(
        `INSERT INTO shared_resource_usage (resource_key, used, reset_at) VALUES ${keys.map(() => '(?, 0, ?)').join(', ')} ON DUPLICATE KEY UPDATE reset_at = GREATEST(reset_at, VALUES(reset_at))`,
        keys.flatMap((key) => [key, until]),
      );
      await connection.query(
        `SELECT resource_key FROM shared_resource_usage WHERE resource_key IN (${placeholders}) ORDER BY resource_key FOR UPDATE`,
        keys,
      );
      await connection.execute(
        `DELETE FROM shared_resource_leases WHERE resource_key IN (${placeholders}) AND expires_at <= ?`,
        [...keys, now],
      );
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT resource_key, COUNT(*) AS total, MIN(expires_at) AS earliest FROM shared_resource_leases WHERE resource_key IN (${placeholders}) GROUP BY resource_key`,
        keys,
      );
      const usage = new Map(rows.map((row) => [String(row.resource_key), row]));
      // 拒绝优先级沿用调用方维度顺序，与数据库锁顺序独立。
      for (const { key, limit } of resources) {
        const row = usage.get(key);
        if (Number(row?.total ?? 0) >= limit)
          return {
            allowed: false,
            rejectedKey: key,
            retryAfterMs: Math.max(1, Number(row?.earliest ?? until) - now),
          };
      }
      await connection.execute(
        `INSERT INTO shared_resource_leases (resource_key, token, expires_at) VALUES ${keys.map(() => '(?, ?, ?)').join(', ')}`,
        keys.flatMap((key) => [key, token, until]),
      );
      return { allowed: true };
    });
  }

  async renewLeases(
    keys: readonly string[],
    token: string,
    now: number,
    until: number,
  ) {
    const sorted = [...new Set(keys)].sort();
    if (!sorted.length) return true;
    const placeholders = sorted.map(() => '?').join(', ');
    const lostLease = new Error('Resource lease lost');
    try {
      return await this.transaction(async (connection) => {
        await connection.execute(
          `UPDATE shared_resource_usage SET reset_at = GREATEST(reset_at, ?) WHERE resource_key IN (${placeholders}) ORDER BY resource_key`,
          [until, ...sorted],
        );
        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE shared_resource_leases SET expires_at = ? WHERE resource_key IN (${placeholders}) AND token = ? AND expires_at > ? ORDER BY resource_key`,
          [until, ...sorted, token, now],
        );
        if (result.affectedRows !== sorted.length) throw lostLease;
        return true;
      });
    } catch (error) {
      if (error === lostLease) return false;
      throw error;
    }
  }

  async releaseLeases(keys: readonly string[], token: string) {
    if (!keys.length) return;
    await this.initialize();
    await this.pool.execute(
      `DELETE FROM shared_resource_leases WHERE resource_key IN (${keys.map(() => '?').join(', ')}) AND token = ?`,
      [...keys, token],
    );
  }

  async prune(now: number) {
    await this.initialize();
    await pruneResourceBatches(async (limit) => {
      // query 将 LIMIT 格式化为整数字面量，避开 execute 的 DOUBLE 参数类型。
      const [leases] = await this.pool.query<ResultSetHeader>(
        'DELETE FROM shared_resource_leases WHERE expires_at <= ? LIMIT ?',
        [now, limit],
      );
      const [usage] = await this.pool.query<ResultSetHeader>(
        'DELETE FROM shared_resource_usage WHERE reset_at <= ? LIMIT ?',
        [now, limit],
      );
      return Math.max(leases.affectedRows, usage.affectedRows);
    });
  }
}
