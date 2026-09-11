import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';

import type { SharedResourceStore } from '@/lib/shared-resource-store';

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

  async acquire(
    key: string,
    token: string,
    limit: number,
    now: number,
    until: number,
  ) {
    return this.transaction(async (connection) => {
      await connection.execute(
        'INSERT INTO shared_resource_usage (resource_key, used, reset_at) VALUES (?, 0, ?) ON DUPLICATE KEY UPDATE reset_at = GREATEST(reset_at, ?)',
        [key, until, until],
      );
      await connection.query(
        'SELECT resource_key FROM shared_resource_usage WHERE resource_key = ? FOR UPDATE',
        [key],
      );
      await connection.execute(
        'DELETE FROM shared_resource_leases WHERE resource_key = ? AND expires_at <= ?',
        [key, now],
      );
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total, MIN(expires_at) AS earliest FROM shared_resource_leases WHERE resource_key = ?',
        [key],
      );
      const allowed = Number(rows[0].total) < limit;
      if (allowed)
        await connection.execute(
          'INSERT INTO shared_resource_leases (resource_key, token, expires_at) VALUES (?, ?, ?)',
          [key, token, until],
        );
      return {
        allowed,
        retryAfterMs: Math.max(1, Number(rows[0].earliest ?? until) - now),
      };
    });
  }

  async renew(key: string, token: string, now: number, until: number) {
    return this.transaction(async (connection) => {
      await connection.execute(
        'UPDATE shared_resource_usage SET reset_at = GREATEST(reset_at, ?) WHERE resource_key = ?',
        [until, key],
      );
      const [result] = await connection.execute<ResultSetHeader>(
        'UPDATE shared_resource_leases SET expires_at = ? WHERE resource_key = ? AND token = ? AND expires_at > ?',
        [until, key, token, now],
      );
      return result.affectedRows > 0;
    });
  }

  async release(key: string, token: string) {
    await this.initialize();
    await this.pool.execute(
      'DELETE FROM shared_resource_leases WHERE resource_key = ? AND token = ?',
      [key, token],
    );
  }

  async prune(now: number) {
    await this.initialize();
    await this.pool.execute(
      'DELETE FROM shared_resource_leases WHERE expires_at <= ? LIMIT 500',
      [now],
    );
    await this.pool.execute(
      'DELETE FROM shared_resource_usage WHERE reset_at <= ? LIMIT 500',
      [now],
    );
  }
}
