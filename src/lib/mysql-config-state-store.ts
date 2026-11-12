import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise';

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

export class MysqlConfigStateStore {
  constructor(private readonly connection: Pool | PoolConnection) {}

  async subscription(lock = false): Promise<ConfigSubscription> {
    const [rows] = await this.connection.query<
      (SubscriptionRow & RowDataPacket)[]
    >(
      `SELECT * FROM config_subscription WHERE id = 1${lock ? ' FOR UPDATE' : ''}`,
    );
    return subscriptionFromRow(rows[0]);
  }

  async saveSubscription(value: ConfigSubscription, ignore = false) {
    await this.connection.execute(
      ignore
        ? SUBSCRIPTION_INSERT.replace('INSERT INTO', 'INSERT IGNORE INTO')
        : `${SUBSCRIPTION_INSERT} ON DUPLICATE KEY UPDATE url = VALUES(url), auto_update = VALUES(auto_update), last_check = VALUES(last_check), config_file = VALUES(config_file), failure_since = VALUES(failure_since)`,
      subscriptionValues(value),
    );
  }

  async counts(): Promise<Record<string, number>> {
    const [rows] = await this.connection.query<RowDataPacket[]>(
      'SELECT source_key, channel_number FROM live_source_state',
    );
    return Object.fromEntries(
      rows.map((row) => [row.source_key, Number(row.channel_number)]),
    );
  }

  async setCount(key: string, count: number, ignore = false) {
    if (!validChannelNumber(count)) throw new Error('直播频道数无效');
    await this.connection.execute(
      ignore
        ? 'INSERT IGNORE INTO live_source_state (source_key, channel_number, updated_at) VALUES (?, ?, ?)'
        : 'INSERT INTO live_source_state (source_key, channel_number, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE channel_number = VALUES(channel_number), updated_at = VALUES(updated_at)',
      [key, count, Date.now()],
    );
  }

  async prune(current: AdminConfig | null, next: AdminConfig) {
    const keys = new Set((next.LiveConfig || []).map((live) => live.key));
    for (const live of current?.LiveConfig || []) {
      if (!keys.has(live.key))
        await this.connection.execute(
          'DELETE FROM live_source_state WHERE source_key = ?',
          [live.key],
        );
    }
  }

  async migrateSchema() {
    const [columns] = await this.connection.query<RowDataPacket[]>(
      "SHOW COLUMNS FROM config_subscription LIKE 'failure_since'",
    );
    if (columns.length) return;
    try {
      await this.connection.execute(
        "ALTER TABLE config_subscription ADD COLUMN failure_since VARCHAR(32) NOT NULL DEFAULT ''",
      );
    } catch (error) {
      if ((error as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }

  async migrate() {
    // 初始化调用方提供事务连接，锁住配置行后迁移并剥离旧字段。
    const [rows] = await this.connection.query<RowDataPacket[]>(
      'SELECT config_json FROM admin_config WHERE id = 1 FOR UPDATE',
    );
    if (!rows.length) return;
    const original = rows[0].config_json as string;
    const config = JSON.parse(original) as AdminConfig;
    if (!hasLegacyConfigState(config)) return;
    if (
      Object.hasOwn(config, 'ConfigFile') ||
      Object.hasOwn(config, 'ConfigSubscribtion')
    )
      await this.saveSubscription(subscriptionFromConfig(config), true);
    for (const live of config.LiveConfig || []) {
      if (validChannelNumber(live.channelNumber))
        await this.setCount(live.key, live.channelNumber, true);
    }
    const [result] = await this.connection.execute<ResultSetHeader>(
      'UPDATE admin_config SET config_json = ? WHERE id = 1 AND BINARY config_json = BINARY ?',
      [JSON.stringify(stripConfigState(config)), original],
    );
    if (result.affectedRows !== 1) throw new Error('配置迁移冲突');
  }
}
