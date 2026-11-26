/** @jest-environment node */

import { assertWatchLevelContract } from '@/lib/__tests__/__fixtures__/watch-level-contract';
import { LocalSqliteStorage } from '@/lib/sqlite.db';

it('SQLite 观影等级存储契约', async () => {
  await assertWatchLevelContract(new LocalSqliteStorage(':memory:'));
});
