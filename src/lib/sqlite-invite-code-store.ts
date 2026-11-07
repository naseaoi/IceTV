import type Database from 'better-sqlite3';

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

export class SqliteInviteCodeStore {
  constructor(private readonly db: Database.Database) {}

  migrate() {
    this.db
      .transaction(() => {
        const row = this.db
          .prepare('SELECT config_json FROM admin_config WHERE id = 1')
          .get() as { config_json: string } | undefined;
        if (!row) return;
        const config = JSON.parse(row.config_json) as AdminConfig;
        if (!Object.hasOwn(config.UserConfig || {}, 'InviteCodes')) return;
        const usage = Object.fromEntries(
          (
            this.db
              .prepare('SELECT code, used_count FROM invite_code_usage')
              .all() as InviteCodeRow[]
          ).map((item) => [item.code, Number(item.used_count)]),
        );
        for (const item of importedInviteCodes(
          config.UserConfig.InviteCodes,
          usage,
        )) {
          this.db
            .prepare(
              INVITE_INSERT_SQL.replace('INSERT INTO', 'INSERT OR IGNORE INTO'),
            )
            .run(...inviteValues(item));
        }
        delete config.UserConfig.InviteCodes;
        this.db
          .prepare(
            'UPDATE admin_config SET config_json = ? WHERE id = 1 AND config_json = ?',
          )
          .run(JSON.stringify(config), row.config_json);
        this.db.prepare('DELETE FROM invite_code_usage').run();
      })
      .immediate();
  }

  all(): InviteCode[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM invite_codes ORDER BY created_at DESC, code DESC',
        )
        .all() as InviteCodeRow[]
    ).map(inviteFromRow);
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
    return this.db.transaction(() =>
      invitePage(
        this.db.prepare(sql.rows).all(...sql.params) as InviteCodeRow[],
        (
          this.db.prepare(sql.count).get(...sql.countParams) as {
            total: number;
          }
        ).total,
        this.countActive(now),
        query,
      ),
    )();
  }

  create(items: InviteCode[]): InviteCodeCreateResult {
    if (new Set(items.map((item) => item.code)).size !== items.length)
      return 'exists';
    return this.db
      .transaction((): InviteCodeCreateResult => {
        const now = Date.now();
        const existing = this.db.prepare(
          `SELECT 1 FROM invite_codes WHERE code = ? AND ${INVITE_ACTIVE_SQL}`,
        );
        if (items.some((item) => existing.get(item.code, now))) return 'exists';
        if (this.countActive(now) + items.length > MAX_INVITE_CODES)
          return 'limit';
        const remove = this.db.prepare(
          'DELETE FROM invite_codes WHERE code = ?',
        );
        const insert = this.db.prepare(INVITE_INSERT_SQL);
        for (const item of items) {
          remove.run(item.code);
          insert.run(...inviteValues(item));
        }
        return 'created';
      })
      .immediate();
  }

  delete(code: string): boolean {
    return (
      this.db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code)
        .changes > 0
    );
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
