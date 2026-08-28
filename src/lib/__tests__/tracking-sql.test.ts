import {
  buildTrackingSql,
  MYSQL_TRACKING_DIALECT,
  SQLITE_TRACKING_DIALECT,
} from '../tracking-sql';

// 下列 LEGACY_* 是重构前 sqlite.db.ts / mysql.db.ts 里手写谓词的原文照抄
// 作用是钉死生成结果与重构前逐字节一致，改 builder 时若产出变化必须先确认是有意为之

const LEGACY_SQLITE_GROUP_TOTAL =
  "CAST(json_extract(record_json, '$.group_total') AS INTEGER)";
const LEGACY_SQLITE_GROUP_INDEX =
  "CAST(json_extract(record_json, '$.group_index') AS INTEGER)";
const LEGACY_SQLITE_TOTAL_EPISODES =
  "CAST(json_extract(record_json, '$.total_episodes') AS INTEGER)";
const LEGACY_SQLITE_INDEX =
  "CAST(json_extract(record_json, '$.index') AS INTEGER)";
const LEGACY_SQLITE_TOTAL = `CASE
  WHEN COALESCE(${LEGACY_SQLITE_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${LEGACY_SQLITE_GROUP_TOTAL}, 0) <> 0
  THEN ${LEGACY_SQLITE_GROUP_TOTAL}
  ELSE ${LEGACY_SQLITE_TOTAL_EPISODES}
END`;
const LEGACY_SQLITE_CURRENT = `CASE
  WHEN COALESCE(${LEGACY_SQLITE_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${LEGACY_SQLITE_GROUP_TOTAL}, 0) <> 0
  THEN ${LEGACY_SQLITE_GROUP_INDEX}
  ELSE ${LEGACY_SQLITE_INDEX}
END`;
const LEGACY_SQLITE_BASELINE = `CASE
  WHEN COALESCE(${LEGACY_SQLITE_GROUP_TOTAL}, 0) <> 0
  THEN CAST(json_extract(record_json, '$.update_baseline_group_total') AS INTEGER)
  ELSE CAST(json_extract(record_json, '$.update_baseline_episodes') AS INTEGER)
END`;
const LEGACY_SQLITE_CREATED_AT = `COALESCE(
  CAST(json_extract(record_json, '$.update_detected_at') AS INTEGER),
  CAST(json_extract(record_json, '$.metadata_checked_at') AS INTEGER),
  CAST(json_extract(record_json, '$.save_time') AS INTEGER),
  0
)`;
const LEGACY_SQLITE_UNREAD_WHERE = `
  COALESCE(json_extract(record_json, '$.tracking_enabled'), 1) <> 0
  AND ${LEGACY_SQLITE_TOTAL} > COALESCE(${LEGACY_SQLITE_BASELINE}, ${LEGACY_SQLITE_TOTAL})
  AND ${LEGACY_SQLITE_CURRENT} < ${LEGACY_SQLITE_TOTAL}
`;

const LEGACY_MYSQL_GROUP_TOTAL =
  "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.group_total')) AS SIGNED)";
const LEGACY_MYSQL_GROUP_INDEX =
  "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.group_index')) AS SIGNED)";
const LEGACY_MYSQL_TOTAL_EPISODES =
  "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.total_episodes')) AS SIGNED)";
const LEGACY_MYSQL_INDEX =
  "CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.index')) AS SIGNED)";
const LEGACY_MYSQL_TOTAL = `CASE
  WHEN COALESCE(${LEGACY_MYSQL_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${LEGACY_MYSQL_GROUP_TOTAL}, 0) <> 0
  THEN ${LEGACY_MYSQL_GROUP_TOTAL}
  ELSE ${LEGACY_MYSQL_TOTAL_EPISODES}
END`;
const LEGACY_MYSQL_CURRENT = `CASE
  WHEN COALESCE(${LEGACY_MYSQL_GROUP_INDEX}, 0) <> 0
   AND COALESCE(${LEGACY_MYSQL_GROUP_TOTAL}, 0) <> 0
  THEN ${LEGACY_MYSQL_GROUP_INDEX}
  ELSE ${LEGACY_MYSQL_INDEX}
END`;
const LEGACY_MYSQL_BASELINE = `CASE
  WHEN COALESCE(${LEGACY_MYSQL_GROUP_TOTAL}, 0) <> 0
  THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.update_baseline_group_total')) AS SIGNED)
  ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.update_baseline_episodes')) AS SIGNED)
END`;
const LEGACY_MYSQL_CREATED_AT = `COALESCE(
  CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.update_detected_at')) AS UNSIGNED),
  CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.metadata_checked_at')) AS UNSIGNED),
  CAST(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.save_time')) AS UNSIGNED),
  0
)`;
const LEGACY_MYSQL_UNREAD_WHERE = `
  COALESCE(JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.tracking_enabled')), 'true') <> 'false'
  AND ${LEGACY_MYSQL_TOTAL} > COALESCE(${LEGACY_MYSQL_BASELINE}, ${LEGACY_MYSQL_TOTAL})
  AND ${LEGACY_MYSQL_CURRENT} < ${LEGACY_MYSQL_TOTAL}
`;

describe('buildTrackingSql', () => {
  it('SQLite 产出与重构前手写谓词逐字节一致', () => {
    const sql = buildTrackingSql(SQLITE_TRACKING_DIALECT);

    expect(sql.total).toBe(LEGACY_SQLITE_TOTAL);
    expect(sql.current).toBe(LEGACY_SQLITE_CURRENT);
    expect(sql.baseline).toBe(LEGACY_SQLITE_BASELINE);
    expect(sql.createdAt).toBe(LEGACY_SQLITE_CREATED_AT);
    expect(sql.unreadWhere).toBe(LEGACY_SQLITE_UNREAD_WHERE);
  });

  it('MySQL 产出与重构前手写谓词逐字节一致', () => {
    const sql = buildTrackingSql(MYSQL_TRACKING_DIALECT);

    expect(sql.total).toBe(LEGACY_MYSQL_TOTAL);
    expect(sql.current).toBe(LEGACY_MYSQL_CURRENT);
    expect(sql.baseline).toBe(LEGACY_MYSQL_BASELINE);
    expect(sql.createdAt).toBe(LEGACY_MYSQL_CREATED_AT);
    expect(sql.unreadWhere).toBe(LEGACY_MYSQL_UNREAD_WHERE);
  });

  it('两方言仅在 JSON 取值与布尔判定上不同，逻辑骨架相同', () => {
    const sqlite = buildTrackingSql(SQLITE_TRACKING_DIALECT);
    const mysql = buildTrackingSql(MYSQL_TRACKING_DIALECT);
    const skeleton = (sql: string) =>
      sql
        .replace(/CAST\(json_extract\([^)]*\)[^)]*\)/g, 'NUM')
        .replace(/CAST\(JSON_UNQUOTE\(JSON_EXTRACT\([^)]*\)\)[^)]*\)/g, 'NUM')
        .replace(/COALESCE\(json_extract[^\n]*/g, 'TRACKING_ENABLED')
        .replace(/COALESCE\(JSON_UNQUOTE[^\n]*'false'/g, 'TRACKING_ENABLED');

    expect(skeleton(sqlite.unreadWhere)).toBe(skeleton(mysql.unreadWhere));
    expect(skeleton(sqlite.total)).toBe(skeleton(mysql.total));
    expect(skeleton(sqlite.current)).toBe(skeleton(mysql.current));
    expect(skeleton(sqlite.baseline)).toBe(skeleton(mysql.baseline));
    expect(skeleton(sqlite.createdAt)).toBe(skeleton(mysql.createdAt));
  });
});
