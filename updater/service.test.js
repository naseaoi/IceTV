/** @jest-environment node */
const http = require('node:http');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { createUpdater } = require('./service');
const { createServer } = require('./server');
const { discover } = require('./docker');

const target = {
  capable: true,
  target: {
    container: 'icetv',
    project: 'ice',
    service: 'icetv',
    image: 'repo:latest',
    currentVersion: '1',
  },
  compose: {
    project: 'ice',
    service: 'icetv',
    workingDir: '/app',
    configFiles: ['/app/compose.yml'],
    envFiles: [],
  },
  imageId: 'old',
};
function fixture() {
  const deps = {
    discover: jest.fn().mockResolvedValue(target),
    inspect: jest.fn().mockResolvedValue({
      Id: 'new',
      Config: { Env: ['NEXT_PUBLIC_APP_VERSION=2'] },
    }),
    runDocker: jest.fn().mockResolvedValue(''),
    waitHealthy: jest.fn().mockResolvedValue(undefined),
  };
  return { deps, updater: createUpdater({}, deps) };
}
async function pulled(updater) {
  expect((await updater.action('pull')).status.job.phase).toBe('pulling');
  await nextTurn();
  expect((await updater.status()).job.phase).toBe('pulled');
}

it('pulls without rebuilding, then verifies and succeeds', async () => {
  const { updater, deps } = fixture();
  await pulled(updater);
  expect(deps.runDocker).toHaveBeenCalledTimes(1);
  expect((await updater.action('restart')).status.job.phase).toBe('restarting');
  await nextTurn();
  expect((await updater.status()).job.phase).toBe('succeeded');
  expect(deps.waitHealthy).toHaveBeenCalledWith(target.compose, 'new', 240000);
});

it('serializes requests even during the initial asynchronous capability check', async () => {
  const { updater, deps } = fixture();
  let resolve;
  deps.discover.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const first = updater.action('pull');
  expect((await updater.action('pull')).code).toBe(409);
  resolve(target);
  await first;
  await nextTurn();
});

it('keeps status available while the target disappears during restart', async () => {
  const { updater, deps } = fixture();
  await pulled(updater);
  let finish;
  deps.waitHealthy.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await updater.action('restart');
  await nextTurn();
  deps.discover.mockResolvedValue({ capable: false });
  expect(await updater.status()).toMatchObject({
    capable: true,
    job: { phase: 'verifying' },
  });
  expect((await updater.action('pull')).code).toBe(409);
  finish();
  await nextTurn();
});

it('rolls back the old image and verifies it after a failed upgrade', async () => {
  const { updater, deps } = fixture();
  await pulled(updater);
  deps.waitHealthy.mockRejectedValueOnce(new Error('private diagnostic'));
  await updater.action('restart');
  await nextTurn();
  const status = await updater.status();
  expect(status.job.phase).toBe('rolled-back');
  expect(status.job.message).not.toContain('private diagnostic');
  expect(deps.runDocker).toHaveBeenCalledWith(['tag', 'old', 'repo:latest'], {
    logOutput: true,
  });
  expect(deps.waitHealthy).toHaveBeenLastCalledWith(
    target.compose,
    'old',
    240000,
  );
});

it('reports failed when rollback health verification fails', async () => {
  const { updater, deps } = fixture();
  await pulled(updater);
  deps.waitHealthy.mockRejectedValue(new Error('failure'));
  await updater.action('restart');
  await nextTurn();
  expect((await updater.status()).job.phase).toBe('failed');
});

it('handles unchanged images, failed pulls, and disallowed restart', async () => {
  const { updater, deps } = fixture();
  expect((await updater.action('restart')).code).toBe(409);
  deps.inspect.mockResolvedValue({ Id: 'old' });
  await updater.action('pull');
  await nextTurn();
  expect((await updater.status()).job.phase).toBe('up-to-date');
  expect((await updater.action('restart')).code).toBe(409);
  deps.runDocker.mockRejectedValueOnce(new Error('credentials'));
  await updater.action('pull');
  await nextTurn();
  expect((await updater.status()).job.phase).toBe('failed');
  deps.discover.mockResolvedValue({ capable: false, reason: '不可用' });
  expect((await updater.action('pull')).code).toBe(409);
});

it('rejects a restart when the staged image was replaced externally', async () => {
  const { updater, deps } = fixture();
  await pulled(updater);
  deps.inspect.mockResolvedValue({ Id: 'unexpected' });
  expect((await updater.action('restart')).code).toBe(409);
  expect(deps.runDocker).toHaveBeenCalledTimes(1);
});

it('returns incapable for a missing target container', async () => {
  expect(
    await discover('absent', jest.fn().mockRejectedValue(new Error('missing'))),
  ).toMatchObject({ capable: false });
});

it('serves authenticated HTTP status and rejects incorrect tokens', async () => {
  const token = 'x'.repeat(32);
  const updater = {
    status: jest.fn().mockResolvedValue({
      capable: false,
      reason: '目标不存在',
      job: { phase: 'idle' },
    }),
    action: jest.fn().mockResolvedValue({
      code: 409,
      status: { capable: false, job: { phase: 'idle' } },
    }),
  };
  const server = createServer({ token }, updater);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = (path, authorization, method = 'GET') =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server.address().port,
          path,
          method,
          headers: authorization ? { authorization } : {},
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => resolve({ code: res.statusCode, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  try {
    expect((await request('/status')).code).toBe(401);
    expect((await request('/status', 'Bearer wrong')).code).toBe(401);
    expect(updater.status).not.toHaveBeenCalled();
    const response = await request('/status', `Bearer ${token}`);
    expect(response.code).toBe(200);
    expect(JSON.parse(response.body).capable).toBe(false);
    expect((await request('/restart', `Bearer ${token}`, 'POST')).code).toBe(
      409,
    );
    expect(await request('/healthz')).toEqual({ code: 204, body: '' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
