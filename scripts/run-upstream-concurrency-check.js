const { spawnSync } = require('child_process');

const result = spawnSync(
  process.execPath,
  [
    require.resolve('jest/bin/jest'),
    'src/performance/upstream-concurrency.test.ts',
    '--runInBand',
    '--verbose',
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, RUN_UPSTREAM_CONCURRENCY_CHECK: '1' },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
