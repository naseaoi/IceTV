/** @jest-environment node */
import { mkdtemp, readdir, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { db } from '@/lib/db';

import { backupBeforeUpgrade } from '../backup.server';

jest.mock('@/lib/db', () => ({ db: { backupSqlite: jest.fn() } }));
jest.mock('@/lib/version', () => ({ CURRENT_VERSION: '1.2.3-dev.4' }));

const backup = jest.mocked(db.backupSqlite);
let directory: string;
beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(1000);
  directory = await mkdtemp(path.join(tmpdir(), 'icetv-upgrade-test-'));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
it('MySQL 跳过备份', async () => {
  backup.mockResolvedValue(undefined);
  await expect(backupBeforeUpgrade()).resolves.toBeUndefined();
});
it('备份成功后仅保留最近两份且保留其他文件', async () => {
  const destination = path.join(
    directory,
    'icetv-data-1.2.3-dev.4-1000.sqlite',
  );
  for (const [name, time] of [
    ['icetv-data-1.0.0-1.sqlite', 1],
    ['icetv-data-1.1.0-2.sqlite', 2],
    ['manual.sqlite', 3],
  ] as const) {
    const filename = path.join(directory, name);
    await writeFile(filename, 'backup');
    await utimes(filename, time, time);
  }
  backup.mockImplementation(async () => {
    await writeFile(destination, 'new backup');
    return destination;
  });
  await expect(backupBeforeUpgrade()).resolves.toBe(destination);
  expect(backup).toHaveBeenCalledWith('icetv-data-1.2.3-dev.4-1000.sqlite');
  expect((await readdir(directory)).sort()).toEqual([
    'icetv-data-1.1.0-2.sqlite',
    'icetv-data-1.2.3-dev.4-1000.sqlite',
    'manual.sqlite',
  ]);
});
it('备份失败时保留现有备份', async () => {
  await writeFile(path.join(directory, 'icetv-data-1.0.0-1.sqlite'), 'backup');
  backup.mockRejectedValue(new Error('disk full'));
  await expect(backupBeforeUpgrade()).rejects.toThrow('disk full');
  expect(await readdir(directory)).toEqual(['icetv-data-1.0.0-1.sqlite']);
});
