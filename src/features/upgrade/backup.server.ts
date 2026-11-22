import 'server-only';

import { readdir, stat, unlink } from 'fs/promises';
import path from 'path';

import { db } from '@/lib/db';
import { CURRENT_VERSION } from '@/lib/version';

export async function backupBeforeUpgrade(): Promise<string | undefined> {
  const version = CURRENT_VERSION.replace(/[^a-zA-Z0-9.-]/g, '_');
  const destination = await db.backupSqlite(
    `icetv-data-${version}-${Date.now()}.sqlite`,
  );
  if (!destination) return undefined;
  const directory = path.dirname(destination);
  const entries = await readdir(directory, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /^icetv-data-[a-zA-Z0-9._-]+-\d+\.sqlite$/.test(entry.name),
      )
      .map(async (entry) => {
        const filename = path.join(directory, entry.name);
        return { filename, modified: (await stat(filename)).mtimeMs };
      }),
  );
  backups.sort(
    (a, b) => b.modified - a.modified || b.filename.localeCompare(a.filename),
  );
  await Promise.all(backups.slice(2).map((entry) => unlink(entry.filename)));
  return destination;
}
