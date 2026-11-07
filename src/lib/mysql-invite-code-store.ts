import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { InviteCode } from '@/features/admin/services/inviteCodes';
import {
  type InviteCodeCreateResult,
  type InviteCodeQuery,
  type InviteCodeRow,
  importedInviteCodes,
  INVITE_ACTIVE_SQL,
  INVITE_INSERT_SQL,
  inviteFromRow,
  invitePage,
  invitePageStatements,
  inviteValues,
  MAX_INVITE_CODES,
} from '@/lib/invite-code-storage';
import type { AdminConfig } from '@/types/admin';

type Row = InviteCodeRow & RowDataPacket;

export class MysqlInviteCodeStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(
    work: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async migrate(): Promise<void> {
    await this.transaction(async (connection) => {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT config_json FROM admin_config WHERE id = 1 FOR UPDATE',
      );
      if (!rows.length) return;
      const original = rows[0].config_json as string;
      const config = JSON.parse(original) as AdminConfig;
      if (!Object.hasOwn(config.UserConfig || {}, 'InviteCodes')) return;
      const [usageRows] = await connection.query<Row[]>(
        'SELECT code, used_count FROM invite_code_usage',
      );
      const usage = Object.fromEntries(
        usageRows.map((row) => [row.code, Number(row.used_count)]),
      );
      for (const item of importedInviteCodes(
        config.UserConfig.InviteCodes,
        usage,
      )) {
        await connection.execute(
          INVITE_INSERT_SQL.replace('INSERT INTO', 'INSERT IGNORE INTO'),
          inviteValues(item),
        );
      }
      delete config.UserConfig.InviteCodes;
      await connection.execute(
        'UPDATE admin_config SET config_json = ? WHERE id = 1 AND BINARY config_json = BINARY ?',
        [JSON.stringify(config), original],
      );
      await connection.execute('DELETE FROM invite_code_usage');
    });
  }

  async all(): Promise<InviteCode[]> {
    const [rows] = await this.pool.query<Row[]>(
      'SELECT * FROM invite_codes ORDER BY created_at DESC, code DESC',
    );
    return rows.map(inviteFromRow);
  }

  async countActive(now = Date.now()): Promise<number> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM invite_codes WHERE ${INVITE_ACTIVE_SQL}`,
      [now],
    );
    return Number(rows[0].total);
  }

  async page(query: InviteCodeQuery) {
    const now = Date.now();
    const sql = invitePageStatements(query, now);
    return this.transaction(async (connection) => {
      const [rows] = await connection.query<Row[]>(sql.rows, sql.params);
      const [totals] = await connection.query<RowDataPacket[]>(
        sql.count,
        sql.countParams,
      );
      const [active] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM invite_codes WHERE ${INVITE_ACTIVE_SQL}`,
        [now],
      );
      return invitePage(
        rows,
        Number(totals[0].total),
        Number(active[0].total),
        query,
      );
    });
  }

  async create(items: InviteCode[]): Promise<InviteCodeCreateResult> {
    if (new Set(items.map((item) => item.code)).size !== items.length)
      return 'exists';
    return this.transaction(
      async (connection): Promise<InviteCodeCreateResult> => {
        // 管理配置行作为创建操作的互斥锁，限额检查与插入在同一事务执行。
        const [config] = await connection.query<RowDataPacket[]>(
          'SELECT config_json FROM admin_config WHERE id = 1 FOR UPDATE',
        );
        if (!config.length) throw new Error('管理员配置尚未初始化');
        const now = Date.now();
        for (const item of items) {
          const [existing] = await connection.query<RowDataPacket[]>(
            `SELECT code FROM invite_codes WHERE code = ? AND ${INVITE_ACTIVE_SQL}`,
            [item.code, now],
          );
          if (existing.length) return 'exists';
        }
        const [active] = await connection.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS total FROM invite_codes WHERE ${INVITE_ACTIVE_SQL}`,
          [now],
        );
        if (Number(active[0].total) + items.length > MAX_INVITE_CODES)
          return 'limit';
        for (const item of items) {
          await connection.execute('DELETE FROM invite_codes WHERE code = ?', [
            item.code,
          ]);
          await connection.execute(INVITE_INSERT_SQL, inviteValues(item));
        }
        return 'created';
      },
    );
  }

  async delete(code: string): Promise<boolean> {
    const [result] = await this.pool.execute(
      'DELETE FROM invite_codes WHERE code = ?',
      [code],
    );
    return Number((result as { affectedRows: number }).affectedRows) > 0;
  }

  async reserve(code: string): Promise<boolean> {
    const [result] = await this.pool.execute(
      `UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ? AND ${INVITE_ACTIVE_SQL}`,
      [code, Date.now()],
    );
    return Number((result as { affectedRows: number }).affectedRows) > 0;
  }

  async release(code: string): Promise<void> {
    await this.pool.execute(
      'UPDATE invite_codes SET used_count = used_count - 1 WHERE code = ? AND used_count > 0',
      [code],
    );
  }
}
