import type Database from 'better-sqlite3';

import {
  type ResourceLeaseAdmission,
  type ResourceLeaseLimit,
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

  async acquireLeases(
    resources: readonly ResourceLeaseLimit[],
    token: string,
    now: number,
    until: number,
  ): Promise<ResourceLeaseAdmission> {
    const keys = [...new Set(resources.map(({ key }) => key))].sort();
    if (!keys.length) return { allowed: true };
    const placeholders = keys.map(() => '?').join(', ');
    return this.database
      .transaction((): ResourceLeaseAdmission => {
        this.database
          .prepare(
            `DELETE FROM shared_resource_leases WHERE resource_key IN (${placeholders}) AND expires_at <= ?`,
          )
          .run(...keys, now);
        const rows = this.database
          .prepare(
            `SELECT resource_key, COUNT(*) AS total, MIN(expires_at) AS earliest FROM shared_resource_leases WHERE resource_key IN (${placeholders}) GROUP BY resource_key`,
          )
          .all(...keys) as Array<{
          resource_key: string;
          total: number;
          earliest: number;
        }>;
        const usage = new Map(rows.map((row) => [row.resource_key, row]));
        for (const { key, limit } of resources) {
          const row = usage.get(key);
          if ((row?.total ?? 0) >= limit)
            return {
              allowed: false,
              rejectedKey: key,
              retryAfterMs: Math.max(1, (row?.earliest ?? until) - now),
            };
        }
        this.database
          .prepare(
            `INSERT INTO shared_resource_leases (resource_key, token, expires_at) VALUES ${keys.map(() => '(?, ?, ?)').join(', ')}`,
          )
          .run(...keys.flatMap((key) => [key, token, until]));
        return { allowed: true };
      })
      .immediate();
  }

  async renewLeases(
    keys: readonly string[],
    token: string,
    now: number,
    until: number,
  ) {
    const sorted = [...new Set(keys)].sort();
    if (!sorted.length) return true;
    const lostLease = new Error('Resource lease lost');
    try {
      return this.database
        .transaction(() => {
          const result = this.database
            .prepare(
              `UPDATE shared_resource_leases SET expires_at = ? WHERE resource_key IN (${sorted.map(() => '?').join(', ')}) AND token = ? AND expires_at > ?`,
            )
            .run(until, ...sorted, token, now);
          if (result.changes !== sorted.length) throw lostLease;
          return true;
        })
        .immediate();
    } catch (error) {
      if (error === lostLease) return false;
      throw error;
    }
  }

  async releaseLeases(keys: readonly string[], token: string) {
    if (!keys.length) return;
    this.database
      .prepare(
        `DELETE FROM shared_resource_leases WHERE resource_key IN (${keys.map(() => '?').join(', ')}) AND token = ?`,
      )
      .run(...keys, token);
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
