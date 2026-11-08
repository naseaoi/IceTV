import type Database from 'better-sqlite3';

import {
  type ConfigSubscription,
  type SubscriptionRow,
  hasLegacyConfigState,
  stripConfigState,
  SUBSCRIPTION_INSERT,
  subscriptionFromConfig,
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

  saveSubscription(value: ConfigSubscription, ignore = false) {
    this.db
      .prepare(
        ignore
          ? SUBSCRIPTION_INSERT.replace('INSERT INTO', 'INSERT OR IGNORE INTO')
          : `${SUBSCRIPTION_INSERT} ON CONFLICT(id) DO UPDATE SET url = excluded.url, auto_update = excluded.auto_update, last_check = excluded.last_check, config_file = excluded.config_file`,
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

  setCount(key: string, count: number, ignore = false) {
    if (!validChannelNumber(count)) throw new Error('直播频道数无效');
    this.db
      .prepare(
        ignore
          ? 'INSERT OR IGNORE INTO live_source_state (source_key, channel_number, updated_at) VALUES (?, ?, ?)'
          : 'INSERT INTO live_source_state (source_key, channel_number, updated_at) VALUES (?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET channel_number = excluded.channel_number, updated_at = excluded.updated_at',
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

  migrate() {
    this.db
      .transaction(() => {
        const row = this.db
          .prepare('SELECT config_json FROM admin_config WHERE id = 1')
          .get() as { config_json: string } | undefined;
        if (!row) return;
        const config = JSON.parse(row.config_json) as AdminConfig;
        if (!hasLegacyConfigState(config)) return;
        if (
          Object.hasOwn(config, 'ConfigFile') ||
          Object.hasOwn(config, 'ConfigSubscribtion')
        )
          this.saveSubscription(subscriptionFromConfig(config), true);
        for (const live of config.LiveConfig || []) {
          if (validChannelNumber(live.channelNumber))
            this.setCount(live.key, live.channelNumber, true);
        }
        const result = this.db
          .prepare(
            'UPDATE admin_config SET config_json = ? WHERE id = 1 AND config_json = ?',
          )
          .run(JSON.stringify(stripConfigState(config)), row.config_json);
        if (result.changes !== 1) throw new Error('配置迁移冲突');
      })
      .immediate();
  }
}
