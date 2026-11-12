export interface TrackingSqlDialect {
  jsonNumber(field: string): string;
  jsonReal(field: string): string;
  jsonTimestamp(field: string): string;
  trackingEnabled(): string;
}

export const SQLITE_TRACKING_DIALECT: TrackingSqlDialect = {
  jsonReal: (field) => `CAST(json_extract(record_json, '$.${field}') AS REAL)`,
  jsonNumber: (field) =>
    `CAST(json_extract(record_json, '$.${field}') AS INTEGER)`,
  jsonTimestamp: (field) =>
    `CAST(json_extract(record_json, '$.${field}') AS INTEGER)`,
  trackingEnabled: () =>
    `COALESCE(json_extract(record_json, '$.tracking_enabled'), COALESCE(json_extract(record_json, '$.series_status'), '') <> 'ended') <> 0`,
};

export const MYSQL_TRACKING_DIALECT: TrackingSqlDialect = {
  jsonReal: (field) =>
    `CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.${field}')) AS DECIMAL(30, 6))`,
  jsonNumber: (field) =>
    `CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.${field}')) AS SIGNED)`,
  jsonTimestamp: (field) =>
    `CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.${field}')) AS UNSIGNED)`,
  trackingEnabled: () =>
    `COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.tracking_enabled')), 'null'), CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.series_status')) = 'ended' THEN 'false' ELSE 'true' END) <> 'false'`,
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
  WHEN ${inGroupScale}
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

// 保存时间窗口由调用方绑定参数，分页与计数使用同一个截止时刻。
export function buildShelvedPlayRecordWhere(
  dialect: TrackingSqlDialect,
): string {
  const { total, current } = buildTrackingSql(dialect);
  return `${dialect.jsonTimestamp('save_time')} < ?
    AND NOT (COALESCE(${total}, 0) > 0 AND COALESCE(${current}, 0) >= ${total}
      AND COALESCE(${dialect.jsonReal('total_time')}, 0) > 0
      AND COALESCE(${dialect.jsonReal('play_time')}, 0) >= ${dialect.jsonReal('total_time')} * 0.9)`;
}
