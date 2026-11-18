import { applyEpisodeProgressWrite } from '@/lib/episode-progress';
import {
  hasPlayRecordGroupChanged,
  isGroupedPlayRecordScale,
  mergePlayRecordUpdateBaseline,
} from '@/lib/play-records';
import { normalizeWorkTitle, normalizeWorkYear } from '@/lib/source-match';
import type { IStorage, PlayRecord } from '@/lib/types';
import { parseStorageKey } from '@/lib/utils';

export const PLAY_RECORD_WRITE_ATTEMPTS = 8;

type PlayRecordStore = Pick<
  IStorage,
  'getPlayRecordSnapshot' | 'setPlayRecordIfUnchanged'
>;

type PlayProgressStore = PlayRecordStore &
  Pick<IStorage, 'getLatestPlayRecordByTitle'>;

export class PlayRecordConflictError extends Error {
  constructor() {
    super('Play record changed during save');
    this.name = 'PlayRecordConflictError';
  }
}

export async function updatePlayRecordWithRetry(
  storage: PlayRecordStore,
  username: string,
  key: string,
  update: (
    current: PlayRecord | null,
  ) => PlayRecord | null | Promise<PlayRecord | null>,
): Promise<PlayRecord | null> {
  for (let attempt = 0; attempt < PLAY_RECORD_WRITE_ATTEMPTS; attempt++) {
    const snapshot = await storage.getPlayRecordSnapshot(username, key);
    const current: PlayRecord | null =
      snapshot === null ? null : JSON.parse(snapshot);
    const next = await update(current);
    if (next === null) return null;
    if (await storage.setPlayRecordIfUnchanged(username, key, next, snapshot)) {
      return next;
    }
  }
  throw new PlayRecordConflictError();
}

function isSameEpisodeScale(left: PlayRecord, right: PlayRecord): boolean {
  if (!isGroupedPlayRecordScale(left)) return !isGroupedPlayRecordScale(right);
  return (
    isGroupedPlayRecordScale(right) &&
    !!left.group_label?.trim() &&
    !!right.group_label?.trim() &&
    !hasPlayRecordGroupChanged(left, right)
  );
}

async function findOtherSourceRecord(
  storage: PlayProgressStore,
  username: string,
  key: string,
  record: PlayRecord,
): Promise<PlayRecord | null> {
  try {
    const matches = await storage.getLatestPlayRecordByTitle(
      username,
      record.title,
      record.year || '',
      { excludeKey: key, matchEmptyYear: true },
    );
    const [otherKey, other] = Object.entries(matches)[0] ?? [];
    if (
      !other ||
      otherKey === key ||
      normalizeWorkYear(other.year) !== normalizeWorkYear(record.year) ||
      normalizeWorkTitle(other.title) !== normalizeWorkTitle(record.title)
    ) {
      return null;
    }
    return other;
  } catch (err) {
    console.warn('查找同作品播放记录失败', err);
    return null;
  }
}

export function savePlayProgressWithRetry(
  storage: PlayProgressStore,
  username: string,
  key: string,
  record: PlayRecord,
): Promise<PlayRecord | null> {
  let otherSourceRecord: Promise<PlayRecord | null> | undefined;
  const source = parseStorageKey(key)?.source;
  return updatePlayRecordWithRetry(storage, username, key, async (current) => {
    if (
      record.progress_session_id !== undefined &&
      record.progress_session_id === current?.progress_session_id &&
      record.progress_sequence! <= (current.progress_sequence ?? 0)
    ) {
      return null;
    }
    const other = current
      ? null
      : await (otherSourceRecord ??= findOtherSourceRecord(
          storage,
          username,
          key,
          record,
        ));
    const previous =
      current ?? (other && isSameEpisodeScale(other, record) ? other : null);
    const next = mergePlayRecordUpdateBaseline(previous, {
      ...record,
      // 检查时间只由定时刷新推进；客户端详情可能来自过期快照，不能顶替服务端检查
      metadata_checked_at: current?.metadata_checked_at,
      // 旧客户端不携带水位，其保存仍然生效，但保留当前会话的仲裁信息。
      progress_session_id:
        record.progress_session_id ?? current?.progress_session_id,
      progress_sequence: record.progress_sequence ?? current?.progress_sequence,
    });
    const progress = applyEpisodeProgressWrite(
      (current ?? other)?.episode_progress,
      record,
      { source },
    );
    if (progress) next.episode_progress = progress;
    else delete next.episode_progress;
    delete next.episode_key;
    return next;
  });
}
