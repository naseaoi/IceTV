import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';

export interface PlayRecordTitleRow {
  record_key: string;
  title: string;
  year: string;
}

// 只扫描标题投影，命中后才取一条完整记录；两后端共用 JS 归一化，避免 SQL 排序规则改变作品身份。
export async function findLatestPlayRecordKeyByTitle(
  title: string,
  year: string,
  readPage: (offset: number, limit: number) => Promise<PlayRecordTitleRow[]>,
): Promise<string | null> {
  const normalizedTitle = normalizeWorkTitle(title);
  if (!normalizedTitle) return null;
  const normalizedYear = normalizeWorkYear(year);
  const pageSize = 100;
  for (let offset = 0; offset < 500; offset += pageSize) {
    const rows = await readPage(offset, pageSize);
    const match = rows.find(
      (row) =>
        normalizeWorkTitle(row.title || '') === normalizedTitle &&
        (!normalizedYear || normalizeWorkYear(row.year) === normalizedYear),
    );
    if (match) return match.record_key;
    if (rows.length < pageSize) return null;
  }
  return null;
}
