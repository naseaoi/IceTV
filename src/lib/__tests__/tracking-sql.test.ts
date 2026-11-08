import {
  buildTrackingSql,
  MYSQL_TRACKING_DIALECT,
  SQLITE_TRACKING_DIALECT,
} from '../tracking-sql';

// 保持分组刻度与时间读取契约，追更默认值按作品状态判定。

const EXPECTED_SQLITE_GROUP_TOTAL =
  "CAST(json_extract(record_json, '$.group_total') AS INTEGER)";
const EXPECTED_SQLITE_GROUP_INDEX =
  "CAST(json_extract(record_json, '$.group_index') AS INTEGER)";
const EXPECTED_SQLITE_TOTAL_EPISODES =
  "CAST(json_extract(record_json, '$.total_episodes') AS INTEGER)";
const EXPECTED_SQLITE_INDEX =
  "CAST(json_extract(record_json, '$.index') AS INTEGER)";
const EXPECTED_SQLITE_TOTAL = `CASE
  WHEN COALESCE(${EXPECTED_SQLITE_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${EXPECTED_SQLITE_GROUP_TOTAL}, 0) <> 0
  THEN ${EXPECTED_SQLITE_GROUP_TOTAL}
  ELSE ${EXPECTED_SQLITE_TOTAL_EPISODES}
END`;
const EXPECTED_SQLITE_CURRENT = `CASE
  WHEN COALESCE(${EXPECTED_SQLITE_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${EXPECTED_SQLITE_GROUP_TOTAL}, 0) <> 0
  THEN ${EXPECTED_SQLITE_GROUP_INDEX}
  ELSE ${EXPECTED_SQLITE_INDEX}
END`;
const EXPECTED_SQLITE_BASELINE = `CASE
  WHEN COALESCE(${EXPECTED_SQLITE_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${EXPECTED_SQLITE_GROUP_TOTAL}, 0) <> 0
  THEN CAST(json_extract(record_json, '$.update_baseline_group_total') AS INTEGER)
  ELSE CAST(json_extract(record_json, '$.update_baseline_episodes') AS INTEGER)
END`;
const EXPECTED_SQLITE_CREATED_AT = `COALESCE(
  CAST(json_extract(record_json, '$.update_detected_at') AS INTEGER),
  CAST(json_extract(record_json, '$.metadata_checked_at') AS INTEGER),
  CAST(json_extract(record_json, '$.save_time') AS INTEGER),
  0
)`;
const EXPECTED_SQLITE_UNREAD_WHERE = `
  COALESCE(json_extract(record_json, '$.tracking_enabled'), COALESCE(json_extract(record_json, '$.series_status'), '') <> 'ended') <> 0
  AND ${EXPECTED_SQLITE_TOTAL} > COALESCE(${EXPECTED_SQLITE_BASELINE}, ${EXPECTED_SQLITE_TOTAL})
  AND ${EXPECTED_SQLITE_CURRENT} < ${EXPECTED_SQLITE_TOTAL}
`;

const EXPECTED_MYSQL_GROUP_TOTAL =
  "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.group_total')) AS SIGNED)";
const EXPECTED_MYSQL_GROUP_INDEX =
  "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.group_index')) AS SIGNED)";
const EXPECTED_MYSQL_TOTAL_EPISODES =
  "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.total_episodes')) AS SIGNED)";
const EXPECTED_MYSQL_INDEX =
  "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.index')) AS SIGNED)";
const EXPECTED_MYSQL_TOTAL = `CASE
  WHEN COALESCE(${EXPECTED_MYSQL_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${EXPECTED_MYSQL_GROUP_TOTAL}, 0) <> 0
  THEN ${EXPECTED_MYSQL_GROUP_TOTAL}
  ELSE ${EXPECTED_MYSQL_TOTAL_EPISODES}
END`;
const EXPECTED_MYSQL_CURRENT = `CASE
  WHEN COALESCE(${EXPECTED_MYSQL_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${EXPECTED_MYSQL_GROUP_TOTAL}, 0) <> 0
  THEN ${EXPECTED_MYSQL_GROUP_INDEX}
  ELSE ${EXPECTED_MYSQL_INDEX}
END`;
const EXPECTED_MYSQL_BASELINE = `CASE
  WHEN COALESCE(${EXPECTED_MYSQL_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${EXPECTED_MYSQL_GROUP_TOTAL}, 0) <> 0
  THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.update_baseline_group_total')) AS SIGNED)
  ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.update_baseline_episodes')) AS SIGNED)
END`;
const EXPECTED_MYSQL_CREATED_AT = `COALESCE(
  CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.update_detected_at')) AS UNSIGNED),
  CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.metadata_checked_at')) AS UNSIGNED),
  CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.save_time')) AS UNSIGNED),
  0
)`;
const EXPECTED_MYSQL_UNREAD_WHERE = `
  COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.tracking_enabled')), 'null'), CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.series_status')) = 'ended' THEN 'false' ELSE 'true' END) <> 'false'
  AND ${EXPECTED_MYSQL_TOTAL} > COALESCE(${EXPECTED_MYSQL_BASELINE}, ${EXPECTED_MYSQL_TOTAL})
  AND ${EXPECTED_MYSQL_CURRENT} < ${EXPECTED_MYSQL_TOTAL}
`;

describe('buildTrackingSql', () => {
  it('SQLite 产出符合当前追更契约', () => {
    const sql = buildTrackingSql(SQLITE_TRACKING_DIALECT);

    expect(sql.total).toBe(EXPECTED_SQLITE_TOTAL);
    expect(sql.current).toBe(EXPECTED_SQLITE_CURRENT);
    expect(sql.baseline).toBe(EXPECTED_SQLITE_BASELINE);
    expect(sql.createdAt).toBe(EXPECTED_SQLITE_CREATED_AT);
    expect(sql.unreadWhere).toBe(EXPECTED_SQLITE_UNREAD_WHERE);
  });

  it('MySQL 产出符合当前追更契约', () => {
    const sql = buildTrackingSql(MYSQL_TRACKING_DIALECT);

    expect(sql.total).toBe(EXPECTED_MYSQL_TOTAL);
    expect(sql.current).toBe(EXPECTED_MYSQL_CURRENT);
    expect(sql.baseline).toBe(EXPECTED_MYSQL_BASELINE);
    expect(sql.createdAt).toBe(EXPECTED_MYSQL_CREATED_AT);
    expect(sql.unreadWhere).toBe(EXPECTED_MYSQL_UNREAD_WHERE);
  });

  it('两方言仅在 JSON 取值与布尔判定上不同，逻辑骨架相同', () => {
    const sqlite = buildTrackingSql(SQLITE_TRACKING_DIALECT);
    const mysql = buildTrackingSql(MYSQL_TRACKING_DIALECT);
    const skeleton = (sql: string) =>
      sql
        .replace(/CAST\(json_extract\([^)]*\)[^)]*\)/g, 'NUM')
        .replace(/CAST\(JSON_UNQUOTE\(JSON_EXTRACT\([^)]*\)\)[^)]*\)/g, 'NUM')
        .replace(/COALESCE\(json_extract[^\n]*/g, 'TRACKING_ENABLED')
        .replace(/COALESCE\(NULLIF[^\n]*/g, 'TRACKING_ENABLED');

    expect(skeleton(sqlite.unreadWhere)).toBe(skeleton(mysql.unreadWhere));
    expect(skeleton(sqlite.total)).toBe(skeleton(mysql.total));
    expect(skeleton(sqlite.current)).toBe(skeleton(mysql.current));
    expect(skeleton(sqlite.baseline)).toBe(skeleton(mysql.baseline));
    expect(skeleton(sqlite.createdAt)).toBe(skeleton(mysql.createdAt));
  });
});
