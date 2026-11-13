import { mergePlayRecordUpdateBaseline } from '@/lib/play-records';
import type { IStorage, PlayRecord } from '@/lib/types';

export const PLAY_RECORD_WRITE_ATTEMPTS = 8;

type PlayRecordStore = Pick<
  IStorage,
  'getPlayRecordSnapshot' | 'setPlayRecordIfUnchanged'
>;

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
  update: (current: PlayRecord | null) => PlayRecord | null,
): Promise<PlayRecord | null> {
  for (let attempt = 0; attempt < PLAY_RECORD_WRITE_ATTEMPTS; attempt++) {
    const snapshot = await storage.getPlayRecordSnapshot(username, key);
    const current: PlayRecord | null =
      snapshot === null ? null : JSON.parse(snapshot);
    const next = update(current);
    if (next === null) return null;
    if (await storage.setPlayRecordIfUnchanged(username, key, next, snapshot)) {
      return next;
    }
  }
  throw new PlayRecordConflictError();
}

export function savePlayProgressWithRetry(
  storage: PlayRecordStore,
  username: string,
  key: string,
  record: PlayRecord,
): Promise<PlayRecord | null> {
  return updatePlayRecordWithRetry(storage, username, key, (current) => {
    if (
      record.progress_session_id !== undefined &&
      record.progress_session_id === current?.progress_session_id &&
      record.progress_sequence! <= (current.progress_sequence ?? 0)
    ) {
      return null;
    }
    return mergePlayRecordUpdateBaseline(current, {
      ...record,
      // 旧客户端不携带水位，其保存仍然生效，但保留当前会话的仲裁信息。
      progress_session_id:
        record.progress_session_id ?? current?.progress_session_id,
      progress_sequence: record.progress_sequence ?? current?.progress_sequence,
    });
  });
}
