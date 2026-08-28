export interface TrackingSqlDialect {
  jsonNumber(field: string): string;
  jsonTimestamp(field: string): string;
  trackingEnabled(): string;
}

export const SQLITE_TRACKING_DIALECT: TrackingSqlDialect = {
  jsonNumber: (field) =>
    `CAST(json_extract(record_json, '$.${field}') AS INTEGER)`,
  jsonTimestamp: (field) =>
    `CAST(json_extract(record_json, '$.${field}') AS INTEGER)`,
  trackingEnabled: () =>
    `COALESCE(json_extract(record_json, '$.tracking_enabled'), 1) <> 0`,
};

export const MYSQL_TRACKING_DIALECT: TrackingSqlDialect = {
  jsonNumber: (field) =>
    `CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.${field}')) AS SIGNED)`,
  jsonTimestamp: (field) =>
    `CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.${field}')) AS UNSIGNED)`,
  trackingEnabled: () =>
    `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.tracking_enabled')), 'true') <> 'false'`,
};

export interface TrackingSql {
  total: string;
  current: string;
  baseline: string;
  createdAt: string;
  unreadWhere: string;
}

export function buildTrackingSql(dialect: TrackingSqlDialect): TrackingSql {
  const groupTotal = dialect.jsonNumber('group_total');
  const groupIndex = dialect.jsonNumber('group_index');
  const inGroupScale = `COALESCE(${groupIndex}, 0) <> 0
   AND COALESCE(${groupTotal}, 0) <> 0`;

  const total = `CASE
  WHEN ${inGroupScale}
  THEN ${groupTotal}
  ELSE ${dialect.jsonNumber('total_episodes')}
END`;

  const current = `CASE
  WHEN ${inGroupScale}
  THEN ${groupIndex}
  ELSE ${dialect.jsonNumber('index')}
END`;

  const baseline = `CASE
  WHEN COALESCE(${groupTotal}, 0) <> 0
  THEN ${dialect.jsonNumber('update_baseline_group_total')}
  ELSE ${dialect.jsonNumber('update_baseline_episodes')}
END`;

  const createdAt = `COALESCE(
  ${dialect.jsonTimestamp('update_detected_at')},
  ${dialect.jsonTimestamp('metadata_checked_at')},
  ${dialect.jsonTimestamp('save_time')},
  0
)`;

  const unreadWhere = `
  ${dialect.trackingEnabled()}
  AND ${total} > COALESCE(${baseline}, ${total})
  AND ${current} < ${total}
`;

  return { total, current, baseline, createdAt, unreadWhere };
}
