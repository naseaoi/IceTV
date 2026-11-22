import { mergeEpisodeProgress } from '@/lib/episode-progress';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { PlayRecord, PlayRecordTitleLookupOptions } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export interface PlayRecordTitleRow {
  record_key: string;
  title: string | null;
  year: string | null;
}

type ReadTitlePage = (
  offset: number,
  limit: number,
) => Promise<PlayRecordTitleRow[]>;

async function scanPlayRecordKeysByTitle(
  title: string,
  readPage: ReadTitlePage,
  matches: (row: PlayRecordTitleRow) => boolean,
  firstOnly = false,
): Promise<string[]> {
  const normalizedTitle = normalizeWorkTitle(title);
  const keys: string[] = [];
  if (!normalizedTitle) return keys;

  const pageSize = 100;
  for (let offset = 0; offset < 500; offset += pageSize) {
    const rows = await readPage(offset, pageSize);
    for (const row of rows) {
      if (
        matches(row) &&
        typeof row.title === 'string' &&
        normalizeWorkTitle(row.title) === normalizedTitle
      ) {
        keys.push(row.record_key);
        if (firstOnly) return keys;
      }
    }
    if (rows.length < pageSize) break;
  }
  return keys;
}

export async function findLatestPlayRecordKeyByTitle(
  title: string,
  year: string,
  readPage: ReadTitlePage,
  options: PlayRecordTitleLookupOptions = {},
): Promise<string | null> {
  const normalizedYear = normalizeWorkYear(year);
  const [key] = await scanPlayRecordKeysByTitle(
    title,
    readPage,
    (row) =>
      row.record_key !== options.excludeKey &&
      ((!normalizedYear && !options.matchEmptyYear) ||
        normalizeWorkYear(
          typeof row.year === 'string' ? row.year : undefined,
        ) === normalizedYear),
    true,
  );
  return key ?? null;
}

export async function findDuplicatePlayRecordKeys(
  keepKey: string,
  keepRecord: PlayRecord | null,
  preserveKey: string | undefined,
  readPage: ReadTitlePage,
): Promise<string[]> {
  const { title, year } = keepRecord ?? {};
  if (
    typeof title !== 'string' ||
    typeof year !== 'string' ||
    !normalizeWorkYear(year)
  ) {
    return [];
  }
  return scanPlayRecordKeysByTitle(
    title,
    readPage,
    (row) =>
      row.record_key !== keepKey &&
      row.record_key !== preserveKey &&
      row.year === year,
  );
}

export function prepareDuplicatePlayRecordMerge(
  keepKey: string,
  keepRecord: PlayRecord,
  candidateKeys: string[],
  readRecord: (key: string) => PlayRecord | null,
): { deletedKeys: string[]; updatedRecord?: PlayRecord } {
  const title = normalizeWorkTitle(keepRecord.title);
  const deletedKeys: string[] = [];
  const progressLists = [keepRecord.episode_progress];
  for (const key of candidateKeys) {
    const duplicate = readRecord(key);
    if (
      !duplicate ||
      duplicate.year !== keepRecord.year ||
      typeof duplicate.title !== 'string' ||
      normalizeWorkTitle(duplicate.title) !== title
    ) {
      continue;
    }
    deletedKeys.push(key);
    progressLists.push(duplicate.episode_progress);
  }
  if (!deletedKeys.length) return { deletedKeys };

  const merged = mergeEpisodeProgress(progressLists, {
    source: parseStorageKey(keepKey)?.source,
  });
  const progress = merged.length ? merged : undefined;
  if (
    JSON.stringify(progress) === JSON.stringify(keepRecord.episode_progress)
  ) {
    return { deletedKeys };
  }
  const updatedRecord = { ...keepRecord };
  if (progress) updatedRecord.episode_progress = progress;
  else delete updatedRecord.episode_progress;
  return { deletedKeys, updatedRecord };
}
