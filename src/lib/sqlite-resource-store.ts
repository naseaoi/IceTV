import type Database from 'better-sqlite3';

import {
  type SharedResourceStore,
  pruneResourceBatches,
} from '@/lib/shared-resource-store';

export class SqliteResourceStore implements SharedResourceStore {
  constructor(private readonly database: Database.Database) {}

  async getCooldown(key: string): Promise<number> {
    const row = this.database
      .prepare(
        'SELECT reset_at FROM shared_resource_usage WHERE resource_key = ?',
      )
      .get(key) as { reset_at: number } | undefined;
    return row?.reset_at ?? 0;
  }

  async extendCooldown(key: string, until: number): Promise<number> {
    const row = this.database
      .prepare(
        'INSERT INTO shared_resource_usage (resource_key, used, reset_at) VALUES (?, 0, ?) ON CONFLICT(resource_key) DO UPDATE SET reset_at = MAX(reset_at, excluded.reset_at) RETURNING reset_at',
      )
      .get(key, until) as { reset_at: number };
    return row.reset_at;
  }

  async consume(
    key: string,
    amount: number,
    limit: number,
    windowMs: number,
    now: number,
  ) {
    return this.database
      .transaction(() => {
        this.database
          .prepare(
            'INSERT OR IGNORE INTO shared_resource_usage (resource_key, used, reset_at) VALUES (?, 0, ?)',
          )
          .run(key, now + windowMs);
        const row = this.database
          .prepare(
            'SELECT used, reset_at FROM shared_resource_usage WHERE resource_key = ?',
          )
          .get(key) as { used: number; reset_at: number };
        const used = row.reset_at <= now ? 0 : row.used;
        const resetAt = row.reset_at <= now ? now + windowMs : row.reset_at;
        const allowed = used + amount <= limit;
        if (allowed)
          this.database
            .prepare(
              'UPDATE shared_resource_usage SET used = ?, reset_at = ? WHERE resource_key = ?',
            )
            .run(used + amount, resetAt, key);
        return { allowed, retryAfterMs: Math.max(1, resetAt - now) };
      })
      .immediate();
  }

  async acquire(
    key: string,
    token: string,
    limit: number,
    now: number,
    until: number,
  ) {
    return this.database
      .transaction(() => {
        this.database
          .prepare(
            'DELETE FROM shared_resource_leases WHERE resource_key = ? AND expires_at <= ?',
          )
          .run(key, now);
        const row = this.database
          .prepare(
            'SELECT COUNT(*) AS total, MIN(expires_at) AS earliest FROM shared_resource_leases WHERE resource_key = ?',
          )
          .get(key) as { total: number; earliest: number | null };
        const allowed = row.total < limit;
        if (allowed)
          this.database
            .prepare(
              'INSERT INTO shared_resource_leases (resource_key, token, expires_at) VALUES (?, ?, ?)',
            )
            .run(key, token, until);
        return {
          allowed,
          retryAfterMs: Math.max(1, (row.earliest ?? until) - now),
        };
      })
      .immediate();
  }

  async renew(key: string, token: string, now: number, until: number) {
    return (
      this.database
        .prepare(
          'UPDATE shared_resource_leases SET expires_at = ? WHERE resource_key = ? AND token = ? AND expires_at > ?',
        )
        .run(until, key, token, now).changes > 0
    );
  }

  async release(key: string, token: string) {
    this.database
      .prepare(
        'DELETE FROM shared_resource_leases WHERE resource_key = ? AND token = ?',
      )
      .run(key, token);
  }

  async prune(now: number) {
    const leases = this.database.prepare(
      'DELETE FROM shared_resource_leases WHERE rowid IN (SELECT rowid FROM shared_resource_leases WHERE expires_at <= ? LIMIT ?)',
    );
    const usage = this.database.prepare(
      'DELETE FROM shared_resource_usage WHERE resource_key IN (SELECT resource_key FROM shared_resource_usage WHERE reset_at <= ? LIMIT ?)',
    );
    await pruneResourceBatches(async (limit) => {
      const deletedLeases = leases.run(now, limit).changes;
      const deletedUsage = usage.run(now, limit).changes;
      return Math.max(deletedLeases, deletedUsage);
    });
  }
}
