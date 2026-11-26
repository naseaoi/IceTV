import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import {
  type ConfigSubscription,
  type SubscriptionRow,
  SUBSCRIPTION_INSERT,
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

  async saveSubscription(value: ConfigSubscription) {
    await this.connection.execute(
      `${SUBSCRIPTION_INSERT} ON DUPLICATE KEY UPDATE url = VALUES(url), auto_update = VALUES(auto_update), last_check = VALUES(last_check), config_file = VALUES(config_file), failure_since = VALUES(failure_since)`,
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

  async setCount(key: string, count: number) {
    if (!validChannelNumber(count)) throw new Error('直播频道数无效');
    await this.connection.execute(
      'INSERT INTO live_source_state (source_key, channel_number, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE channel_number = VALUES(channel_number), updated_at = VALUES(updated_at)',
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
}
