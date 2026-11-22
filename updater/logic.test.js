/** @jest-environment node */
const {
  authorized,
  composeArgs,
  healthResult,
  imageVersion,
  isFixedImage,
  parseComposeLabels,
  transition,
} = require('./logic');
const { readConfig } = require('./server');

const labels = {
  'com.docker.compose.project': 'ice',
  'com.docker.compose.service': 'icetv',
  'com.docker.compose.project.working_dir': '/opt/ice tv',
  'com.docker.compose.project.config_files':
    '/opt/ice tv/compose.yml,override.yml',
  'com.docker.compose.project.environment_file': '.env,/etc/ice.env',
};

describe('Compose metadata and arguments', () => {
  it('preserves file order and spaces as individual spawn arguments', () => {
    const compose = parseComposeLabels(labels);
    const prefix = [
      'compose',
      '-p',
      'ice',
      '--project-directory',
      '/opt/ice tv',
      '-f',
      '/opt/ice tv/compose.yml',
      '-f',
      '/opt/ice tv/override.yml',
      '--env-file',
      '/opt/ice tv/.env',
      '--env-file',
      '/etc/ice.env',
    ];
    expect(composeArgs(compose, 'pull')).toEqual([...prefix, 'pull', 'icetv']);
    expect(composeArgs(compose, 'up')).toEqual([
      ...prefix,
      'up',
      '-d',
      '--no-deps',
      '--pull',
      'never',
      'icetv',
    ]);
    expect(composeArgs(compose, 'ps')).toEqual([
      ...prefix,
      'ps',
      '-a',
      '-q',
      'icetv',
    ]);
    expect(() => composeArgs(compose, 'invalid')).toThrow();
  });
  it('supports optional env files and rejects missing or unsafe labels', () => {
    expect(
      parseComposeLabels({
        ...labels,
        'com.docker.compose.project.environment_file': '',
      }).envFiles,
    ).toEqual([]);
    expect(() => parseComposeLabels({})).toThrow();
    expect(() =>
      parseComposeLabels({ ...labels, 'com.docker.compose.service': '--all' }),
    ).toThrow();
    expect(() =>
      parseComposeLabels({
        ...labels,
        'com.docker.compose.project.working_dir': 'relative',
      }),
    ).toThrow();
    expect(() =>
      parseComposeLabels({
        ...labels,
        'com.docker.compose.project.config_files': 'a, ',
      }),
    ).toThrow();
  });
});

it.each([
  'repo:1.2.3',
  'repo:v1.2.3',
  'repo:1.2.3-dev.4',
  'repo:v1.2.3-dev.4',
  'repo:1.2.3-rc.1',
  'repo@sha256:abc',
])('blocks pinned image %s', (image) => expect(isFixedImage(image)).toBe(true));
it.each([
  'repo',
  'repo:latest',
  'repo:dev',
  'localhost:5000/repo',
  'localhost:5000/repo:dev',
])('accepts floating image %s', (image) =>
  expect(isFixedImage(image)).toBe(false),
);

it('compares full bearer values without exposing token length', () => {
  const token = 'x'.repeat(32);
  expect(authorized(`Bearer ${token}`, token)).toBe(true);
  for (const header of [
    undefined,
    '',
    'x',
    `Basic ${token}`,
    `Bearer ${token}x`,
  ])
    expect(authorized(header, token)).toBe(false);
});

it('requires a token before startup and validates runtime options', () => {
  expect(() => readConfig({})).toThrow('UPDATER_TOKEN');
  expect(() => readConfig({ UPDATER_TOKEN: 'short' })).toThrow();
  const env = { UPDATER_TOKEN: 'x'.repeat(32) };
  expect(readConfig(env)).toMatchObject({
    port: 9330,
    healthTimeout: 240000,
    container: 'icetv',
  });
  expect(() => readConfig({ ...env, UPDATER_PORT: '0' })).toThrow();
  expect(() =>
    readConfig({ ...env, UPDATER_HEALTH_TIMEOUT_MS: 'NaN' }),
  ).toThrow();
  expect(() =>
    readConfig({ ...env, UPDATER_TARGET_CONTAINER: '--all' }),
  ).toThrow();
});

it('extracts version from image metadata, including absent versions', () => {
  expect(
    imageVersion({
      Config: { Env: ['OTHER=value', 'NEXT_PUBLIC_APP_VERSION=1.2.3'] },
    }),
  ).toBe('1.2.3');
  expect(imageVersion({})).toBeNull();
});

it('enforces the state machine and resets stale data for the next pull', () => {
  let job = { phase: 'idle' };
  for (const phase of [
    'pulling',
    'pulled',
    'restarting',
    'verifying',
    'rolling-back',
    'rolled-back',
  ])
    job = transition(job, phase, { message: 'test' }, 100);
  expect(job).toMatchObject({
    phase: 'rolled-back',
    startedAt: 100,
    updatedAt: 100,
  });
  expect(() => transition(job, 'restarting')).toThrow();
  expect(transition(job, 'pulling', {}, 200)).toEqual({
    phase: 'pulling',
    startedAt: 200,
    updatedAt: 200,
  });
  expect(() => transition({ phase: 'idle' }, 'succeeded')).toThrow();
});

it('requires health or twenty continuously running seconds on the expected image', () => {
  const container = {
    Id: 'id',
    Image: 'new',
    RestartCount: 0,
    State: { Status: 'running', StartedAt: 'start' },
  };
  const first = healthResult(container, 'new', null, 1000);
  expect(first.result).toBe('waiting');
  expect(healthResult(container, 'new', first.runningSince, 20999).result).toBe(
    'waiting',
  );
  expect(healthResult(container, 'new', first.runningSince, 21000).result).toBe(
    'ready',
  );
  expect(
    healthResult(
      { ...container, RestartCount: 1 },
      'new',
      first.runningSince,
      21000,
    ).result,
  ).toBe('waiting');
  expect(healthResult(container, 'other', null, 0).result).toBe('failed');
  for (const status of ['exited', 'dead'])
    expect(
      healthResult({ ...container, State: { Status: status } }, 'new', null, 0)
        .result,
    ).toBe('failed');
  for (const [health, result] of [
    ['healthy', 'ready'],
    ['unhealthy', 'failed'],
    ['starting', 'waiting'],
  ]) {
    expect(
      healthResult(
        {
          ...container,
          State: { ...container.State, Health: { Status: health } },
        },
        'new',
        null,
        0,
      ).result,
    ).toBe(result);
  }
});
