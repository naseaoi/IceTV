const { spawnSync } = require('child_process');

const jestBin = require.resolve('jest/bin/jest');
const result = spawnSync(
  process.execPath,
  [
    jestBin,
    'src/performance/non-empty-baseline.test.ts',
    '--runInBand',
    '--verbose',
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, RUN_PERFORMANCE_BASELINE: '1' },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
