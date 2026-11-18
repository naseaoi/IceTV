import {
  PLAY_RECORD_WRITE_ATTEMPTS,
  PlayRecordConflictError,
  savePlayProgressWithRetry,
  updatePlayRecordWithRetry,
} from '@/lib/play-record-write';
import { markPlayRecordUpdateRead } from '@/lib/play-records';
import type { IStorage, PlayRecord } from '@/lib/types';

export async function assertPlayRecordOrdering(storage: IStorage) {
  const user = 'ordering-user';
  const key = 'source+ordered';
  const record: PlayRecord = {
    title: 'Ordering',
    source_name: 'Source',
    cover: '',
    year: '2026',
    index: 1,
    total_episodes: 12,
    play_time: 120,
    total_time: 1200,
    save_time: 9000,
    progress_session_id: 'session-a',
    progress_sequence: 2,
  };
  const save = (next: PlayRecord, target = key) =>
    savePlayProgressWithRetry(storage, user, target, next);
  await save(record);
  expect(await storage.getPlayRecordSnapshot(user, key)).toBe(
    JSON.stringify(await storage.getPlayRecord(user, key)),
  );
  for (const sequence of [1, 2]) {
    expect(
      await save({
        ...record,
        progress_sequence: sequence,
        play_time: 30,
        save_time: 99999,
      }),
    ).toBeNull();
  }
  expect(await storage.getPlayRecord(user, key)).toMatchObject(record);
  await save({
    ...record,
    progress_session_id: 'session-b',
    progress_sequence: 1,
    save_time: 1,
    play_time: 50,
  });
  expect(await storage.getPlayRecord(user, key)).toMatchObject({
    progress_session_id: 'session-b',
    save_time: 1,
    play_time: 50,
  });
  await save(record);
  const legacy = { ...record, play_time: 140 };
  delete legacy.progress_session_id;
  delete legacy.progress_sequence;
  await save(legacy);
  expect(await storage.getPlayRecord(user, key)).toMatchObject({
    progress_session_id: 'session-a',
    progress_sequence: 2,
    play_time: 140,
  });

  await updatePlayRecordWithRetry(
    storage,
    user,
    key,
    (current) =>
      current &&
      markPlayRecordUpdateRead({ ...current, tracking_enabled: false }),
  );
  expect(await save({ ...record, progress_sequence: 1 })).toBeNull();
  expect(await storage.getPlayRecord(user, key)).toMatchObject({
    tracking_enabled: false,
    progress_sequence: 2,
  });

  // 强制两个写入读到同一快照，再同时提交；覆盖首次插入和已有行更新。
  for (const target of ['source+new-race', key]) {
    const originalRead = storage.getPlayRecordSnapshot.bind(storage);
    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const readSpy = jest
      .spyOn(storage, 'getPlayRecordSnapshot')
      .mockImplementation(async (username, readKey) => {
        const snapshot = await originalRead(username, readKey);
        if (readKey === target && ++reads <= 2) {
          if (reads === 2) release();
          await barrier;
        }
        return snapshot;
      });
    try {
      await Promise.all([
        save({ ...record, progress_sequence: 4, play_time: 400 }, target),
        save({ ...record, progress_sequence: 3, play_time: 300 }, target),
      ]);
      expect(reads).toBeGreaterThanOrEqual(3);
      // 新记录沿用同作品其他记录的手动追更设置
      expect(await storage.getPlayRecord(user, target)).toMatchObject({
        progress_sequence: 4,
        play_time: 400,
        tracking_enabled: false,
      });
    } finally {
      readSpy.mockRestore();
    }
  }

  const originalCas = storage.setPlayRecordIfUnchanged.bind(storage);
  const cas = jest
    .spyOn(storage, 'setPlayRecordIfUnchanged')
    .mockImplementationOnce(async (username, target, _next, snapshot) => {
      await originalCas(
        username,
        target,
        { ...record, progress_sequence: 6, play_time: 600 },
        snapshot,
      );
      return false;
    });
  try {
    await updatePlayRecordWithRetry(
      storage,
      user,
      key,
      (current) => current && { ...current, tracking_enabled: false },
    );
    expect(await storage.getPlayRecord(user, key)).toMatchObject({
      progress_sequence: 6,
      play_time: 600,
      tracking_enabled: false,
    });
  } finally {
    cas.mockRestore();
  }

  const blocked = jest
    .spyOn(storage, 'setPlayRecordIfUnchanged')
    .mockResolvedValue(false);
  try {
    await expect(
      save({ ...record, progress_sequence: 7 }),
    ).rejects.toBeInstanceOf(PlayRecordConflictError);
    expect(blocked).toHaveBeenCalledTimes(PLAY_RECORD_WRITE_ATTEMPTS);
  } finally {
    blocked.mockRestore();
  }

  const snapshot = await storage.getPlayRecordSnapshot(user, key);
  await storage.deletePlayRecord(user, key);
  expect(
    await storage.setPlayRecordIfUnchanged(user, key, record, snapshot),
  ).toBe(false);
  expect(
    await updatePlayRecordWithRetry(storage, user, key, (current) => current),
  ).toBeNull();
}

export async function assertPlayRecordEpisodeProgress(storage: IStorage) {
  const user = 'episode-progress-user';
  const key = 'next+1';
  const first = { k: 'n:1', t: 30, d: 100, at: 100 };
  const record: PlayRecord = {
    title: '追更作品',
    year: '',
    source_name: '源',
    cover: '',
    index: 1,
    total_episodes: 12,
    play_time: 25,
    total_time: 100,
    save_time: 300,
  };
  const oldSource: PlayRecord = {
    ...record,
    title: ' 追更·作品 ',
    year: ' Unknown ',
    group_label: '第 1 季',
    group_index: 1,
    group_total: 4,
    save_time: 100,
    update_baseline_group_total: 1,
    update_detected_at: 80,
    episode_progress: [first, { ...first, k: 'i:old:1/12' }],
  };
  const untrustedTable = [{ ...first, k: 'n:99', at: 999 }];
  await storage.setPlayRecords(user, {
    'old+1': oldSource,
    'older+1': {
      ...oldSource,
      save_time: 90,
      episode_progress: untrustedTable,
    },
    'other-year+1': {
      ...record,
      year: '2026',
      save_time: 200,
      episode_progress: untrustedTable,
    },
  });
  const save = (next: PlayRecord) =>
    savePlayProgressWithRetry(storage, user, key, next);
  await save({
    ...record,
    episode_key: 'n:2',
    episode_progress: untrustedTable,
    progress_session_id: 'session-a',
    progress_sequence: 1,
  });
  expect(await storage.getPlayRecord(user, key)).toMatchObject({
    update_baseline_episodes: 12,
    episode_progress: [{ k: 'n:2', t: 25, d: 100, at: 300 }, first],
  });
  expect(await storage.getPlayRecord(user, key)).not.toHaveProperty(
    'update_detected_at',
  );

  const upsert = {
    ...record,
    episode_key: 'n:2',
    play_time: 11,
    save_time: 400,
    progress_session_id: 'session-a',
    progress_sequence: 2,
  };
  const expected = [{ k: 'n:2', t: 11, d: 100, at: 400 }, first];
  await save(upsert);
  const snapshot = await storage.getPlayRecordSnapshot(user, key);
  expect(JSON.parse(snapshot!)).toMatchObject({ episode_progress: expected });
  expect(JSON.parse(snapshot!)).not.toHaveProperty('episode_key');
  await expect(
    save({ ...upsert, episode_key: 'n:3', save_time: 900 }),
  ).resolves.toBeNull();
  expect(await storage.getPlayRecordSnapshot(user, key)).toBe(snapshot);

  await save({ ...record, save_time: 500, play_time: 40 });
  await updatePlayRecordWithRetry(
    storage,
    user,
    key,
    (current) =>
      current &&
      markPlayRecordUpdateRead({ ...current, tracking_enabled: false }),
  );
  expect(await storage.getPlayRecord(user, key)).toMatchObject({
    tracking_enabled: false,
    play_time: 40,
    progress_sequence: 2,
    episode_progress: expected,
  });
}
