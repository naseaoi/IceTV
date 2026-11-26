import type Database from 'better-sqlite3';

import {
  type ConfigSubscription,
  type SubscriptionRow,
  SUBSCRIPTION_INSERT,
  subscriptionFromRow,
  subscriptionValues,
  validChannelNumber,
} from '@/lib/config-state';
import type { AdminConfig } from '@/types/admin';

export class SqliteConfigStateStore {
  constructor(private readonly db: Database.Database) {}

  subscription(): ConfigSubscription {
    return subscriptionFromRow(
      this.db
        .prepare('SELECT * FROM config_subscription WHERE id = 1')
        .get() as SubscriptionRow | undefined,
    );
  }

  saveSubscription(value: ConfigSubscription) {
    this.db
      .prepare(
        `${SUBSCRIPTION_INSERT} ON CONFLICT(id) DO UPDATE SET url = excluded.url, auto_update = excluded.auto_update, last_check = excluded.last_check, config_file = excluded.config_file, failure_since = excluded.failure_since`,
      )
      .run(...subscriptionValues(value));
  }

  counts(): Record<string, number> {
    return Object.fromEntries(
      (
        this.db
          .prepare('SELECT source_key, channel_number FROM live_source_state')
          .all() as { source_key: string; channel_number: number }[]
      ).map((row) => [row.source_key, row.channel_number]),
    );
  }

  setCount(key: string, count: number) {
    if (!validChannelNumber(count)) throw new Error('直播频道数无效');
    this.db
      .prepare(
        'INSERT INTO live_source_state (source_key, channel_number, updated_at) VALUES (?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET channel_number = excluded.channel_number, updated_at = excluded.updated_at',
      )
      .run(key, count, Date.now());
  }

  prune(current: AdminConfig | null, next: AdminConfig) {
    const keys = new Set((next.LiveConfig || []).map((live) => live.key));
    for (const live of current?.LiveConfig || []) {
      if (!keys.has(live.key))
        this.db
          .prepare('DELETE FROM live_source_state WHERE source_key = ?')
          .run(live.key);
    }
  }
}
