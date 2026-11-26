import type Database from 'better-sqlite3';

import type { InviteCode } from '@/features/admin/services/inviteCodes';
import {
  type InviteCodeBatchCreateResult,
  type InviteCodePurge,
  type InviteCodeQuery,
  type InviteCodeRow,
  INVITE_ACTIVE_SQL,
  INVITE_INSERT_SQL,
  inviteFromRow,
  invitePage,
  invitePageStatements,
  invitePurgeStatement,
  inviteValues,
  MAX_INVITE_CODES,
} from '@/lib/invite-code-storage';

export class SqliteInviteCodeStore {
  constructor(private readonly db: Database.Database) {}

  all(): InviteCode[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM invite_codes ORDER BY created_at DESC, code DESC',
        )
        .all() as InviteCodeRow[]
    ).map(inviteFromRow);
  }

  count(): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS total FROM invite_codes').get() as {
        total: number;
      }
    ).total;
  }

  countActive(now = Date.now()): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS total FROM invite_codes WHERE ${INVITE_ACTIVE_SQL}`,
        )
        .get(now) as { total: number }
    ).total;
  }

  page(query: InviteCodeQuery) {
    const now = Date.now();
    const sql = invitePageStatements(query, now);
    return this.db.transaction(() => {
      const active = this.countActive(now);
      return invitePage(
        this.db.prepare(sql.rows).all(...sql.params) as InviteCodeRow[],
        (
          this.db.prepare(sql.count).get(...sql.countParams) as {
            total: number;
          }
        ).total,
        active,
        this.count() - active,
        query,
      );
    })();
  }

  create(items: InviteCode[]): InviteCodeBatchCreateResult {
    if (new Set(items.map((item) => item.code)).size !== items.length)
      return 'exists';
    return this.db
      .transaction((): InviteCodeBatchCreateResult => {
        const now = Date.now();
        const remaining = MAX_INVITE_CODES - this.countActive(now);
        if (remaining <= 0) return 'limit';
        const selected = items.slice(0, remaining);
        const existing = this.db.prepare(
          `SELECT 1 FROM invite_codes WHERE code = ? AND ${INVITE_ACTIVE_SQL}`,
        );
        if (selected.some((item) => existing.get(item.code, now)))
          return 'exists';
        const remove = this.db.prepare(
          'DELETE FROM invite_codes WHERE code = ?',
        );
        const insert = this.db.prepare(INVITE_INSERT_SQL);
        for (const item of selected) {
          remove.run(item.code);
          insert.run(...inviteValues(item));
        }
        return { codes: selected.map((item) => item.code) };
      })
      .immediate();
  }

  delete(code: string): boolean {
    return (
      this.db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code)
        .changes > 0
    );
  }

  purge(options: InviteCodePurge): number {
    const { sql, params } = invitePurgeStatement(options);
    return this.db.prepare(sql).run(...params).changes;
  }

  reserve(code: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ? AND ${INVITE_ACTIVE_SQL}`,
        )
        .run(code, Date.now()).changes > 0
    );
  }

  release(code: string): void {
    this.db
      .prepare(
        'UPDATE invite_codes SET used_count = used_count - 1 WHERE code = ? AND used_count > 0',
      )
      .run(code);
  }
}
