#!/usr/bin/env node
// 起一次性 MySQL 容器跑双后端一致性测试，结束后销毁容器
const { execFileSync, spawnSync } = require('child_process');

const CONTAINER = 'icetv-mysql-test';
const PASSWORD = 'icetv_test_pw';
const DATABASE = 'icetv_test';
const PORT = process.env.MYSQL_TEST_PORT || '33061';
const IMAGE = 'mysql:8.4';
const READY_TIMEOUT_MS = 180_000;
const TEST_PATTERNS = ['mysql-tracking-live', 'tracking-backend-parity'];

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', ...options });
}

function removeContainer() {
  spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' });
}

function assertDockerAvailable() {
  try {
    docker(['version', '--format', '{{.Server.Version}}'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    console.error('Docker 引擎不可用，请先启动 Docker Desktop');
    process.exit(1);
  }
}

function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const probe = spawnSync(
      'docker',
      [
        'exec',
        CONTAINER,
        'mysqladmin',
        'ping',
        '-h',
        '127.0.0.1',
        '-uroot',
        `-p${PASSWORD}`,
        '--silent',
      ],
      { encoding: 'utf8' },
    );
    if (probe.status === 0 && /alive/.test(probe.stdout || '')) return;
    spawnSync('node', ['-e', 'setTimeout(() => {}, 3000)']);
  }
  throw new Error(`MySQL 容器在 ${READY_TIMEOUT_MS / 1000}s 内未就绪`);
}

assertDockerAvailable();
removeContainer();

let exitCode = 1;
try {
  console.log(`启动 ${IMAGE} 容器（端口 ${PORT}）...`);
  docker([
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-e',
    `MYSQL_ROOT_PASSWORD=${PASSWORD}`,
    '-e',
    `MYSQL_DATABASE=${DATABASE}`,
    '-p',
    `${PORT}:3306`,
    IMAGE,
  ]);
  waitForReady();
  console.log('容器就绪，开始跑测试');

  const jestBin = require('path').join(
    __dirname,
    '..',
    'node_modules',
    'jest',
    'bin',
    'jest.js',
  );
  const result = spawnSync(process.execPath, [jestBin, ...TEST_PATTERNS], {
    stdio: 'inherit',
    env: {
      ...process.env,
      MYSQL_TEST_URL: `mysql://root:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`,
    },
  });
  exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
} finally {
  console.log('销毁容器');
  removeContainer();
}

process.exit(exitCode);
