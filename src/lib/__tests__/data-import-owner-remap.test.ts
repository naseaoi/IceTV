/** @jest-environment node */

jest.mock('../env.server', () => ({
  getOwnerUsername: () => 'owner-b',
}));

import { parseImportData } from '../data-import';
import type { StorageUserImportData } from '../types';
import { IMPORT_ADMIN_CONFIG } from './__fixtures__/import-admin-config';

const exportedHash =
  '$2b$10$abcdefghijklmnopqrstuu9dBwFh6R0D4A5gHfHnM6kQ7xS8tT9u';

function userDataWithRecord(saveTime: number): StorageUserImportData {
  return {
    playRecords: {
      'source-a+video-1': {
        title: '标题',
        source_name: '源',
        cover: '',
        year: '2026',
        index: 1,
        total_episodes: 12,
        play_time: 10,
        total_time: 100,
        save_time: saveTime,
        search_title: '',
      },
    },
    favorites: {},
    searchHistory: [],
    skipConfigs: {},
    playbackSessions: {},
  };
}

function createBackup(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-08-29T00:00:00.000Z',
    serverVersion: '0.4.10',
    ownerUsername: 'owner-a',
    data: {
      adminConfig: {
        ...IMPORT_ADMIN_CONFIG,
        UserConfig: {
          ...IMPORT_ADMIN_CONFIG.UserConfig,
          Users: [
            { username: 'owner-a', role: 'owner' as const, banned: false },
            { username: 'demo-user', role: 'admin' as const, banned: false },
          ],
        },
      },
      users: { 'demo-user': exportedHash } as Record<string, string>,
      sourceRouteStats: [],
      inviteCodeUsage: {},
      userData: {
        'owner-a': userDataWithRecord(111),
        'demo-user': userDataWithRecord(222),
      } as Record<string, StorageUserImportData>,
    },
    ...overrides,
  };
}

describe('data import owner remap', () => {
  it('moves the backup owner data onto the local owner account', async () => {
    const parsed = await parseImportData(createBackup());

    expect(parsed.ownerRemappedFrom).toBe('owner-a');
    expect(parsed.snapshot.userData['owner-b']).toBeDefined();
    expect(
      parsed.snapshot.userData['owner-b'].playRecords['source-a+video-1']
        .save_time,
    ).toBe(111);
    expect(parsed.snapshot.userData['owner-a']).toBeUndefined();
  });

  it('never writes a password row for the local owner', async () => {
    const parsed = await parseImportData(createBackup());

    expect(parsed.snapshot.users['owner-b']).toBeUndefined();
    expect(parsed.snapshot.users['owner-a']).toBeUndefined();
    expect(parsed.snapshot.users['demo-user']).toBe(exportedHash);
  });

  it('rewrites the config owner entry to the local owner', async () => {
    const parsed = await parseImportData(createBackup());
    const users = parsed.snapshot.adminConfig.UserConfig.Users;

    expect(users[0]).toMatchObject({ username: 'owner-b', role: 'owner' });
    expect(users.some((user) => user.username === 'owner-a')).toBe(false);
    expect(users.some((user) => user.username === 'demo-user')).toBe(true);
  });

  it('keeps other roles untouched while remapping', async () => {
    const parsed = await parseImportData(createBackup());
    const demo = parsed.snapshot.adminConfig.UserConfig.Users.find(
      (user) => user.username === 'demo-user',
    );

    expect(demo?.role).toBe('admin');
  });

  it('refuses to remap when the backup already holds the local owner name', async () => {
    const backup = createBackup();
    backup.data.userData['owner-b'] = userDataWithRecord(333);

    await expect(parseImportData(backup)).rejects.toThrow(
      /已存在与本机站长同名的用户 owner-b/,
    );
  });

  it('does not remap when both sides share the owner name', async () => {
    const backup = createBackup({ ownerUsername: 'owner-b' });
    backup.data.userData = {
      'owner-b': userDataWithRecord(444),
      'demo-user': userDataWithRecord(222),
    };

    const parsed = await parseImportData(backup);

    expect(parsed.ownerRemappedFrom).toBeUndefined();
    expect(parsed.snapshot.users['owner-b']).toBeUndefined();
    expect(
      parsed.snapshot.userData['owner-b'].playRecords['source-a+video-1']
        .save_time,
    ).toBe(444);
  });

  it('treats owner names case-insensitively', async () => {
    const parsed = await parseImportData(
      createBackup({ ownerUsername: 'Owner-B' }),
    );

    expect(parsed.ownerRemappedFrom).toBeUndefined();
  });

  it('leaves legacy backups without an owner field alone', async () => {
    const backup = createBackup();
    delete (backup as { ownerUsername?: string }).ownerUsername;

    const parsed = await parseImportData(backup);

    expect(parsed.ownerRemappedFrom).toBeUndefined();
    expect(parsed.snapshot.userData['owner-a']).toBeDefined();
    expect(typeof parsed.snapshot.users['owner-a']).toBe('string');
  });

  it('leaves only one owner entry in the config', async () => {
    const backup = createBackup();
    delete (backup as { ownerUsername?: string }).ownerUsername;

    const parsed = await parseImportData(backup);
    const users = parsed.snapshot.adminConfig.UserConfig.Users;
    const owners = users.filter((user) => user.role === 'owner');

    expect(owners).toHaveLength(1);
    expect(owners[0].username).toBe('owner-b');
    expect(users.find((user) => user.username === 'owner-a')?.role).toBe(
      'user',
    );
  });
});
