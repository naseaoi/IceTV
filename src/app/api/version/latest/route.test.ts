/** @jest-environment node */
import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';

const mockUpdateSource = {
  buildChangelogUrls: jest.fn(),
  getUpdateBranch: jest.fn(),
  getUpdateRepos: jest.fn(),
};
jest.mock('@/lib/update-source', () => mockUpdateSource);

installStreamPolyfills();
// 路由在模块内缓存 GHCR 结果，每个用例重新加载以隔离缓存
let GET: typeof import('./route').GET;
const originalFetch = global.fetch;
const fetchMock = jest.fn();
const repo = 'naseaoi/icetv';
const tagsUrl = `https://ghcr.io/v2/${repo}/tags/list?n=1000`;
const json = (data: unknown, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), { headers });

beforeEach(() => {
  jest.isolateModules(() => {
    ({ GET } = require('./route') as typeof import('./route'));
  });
  fetchMock.mockReset();
  global.fetch = fetchMock;
  mockUpdateSource.getUpdateBranch.mockReturnValue('dev');
  mockUpdateSource.getUpdateRepos.mockReturnValue(['naseaoi/IceTV']);
  mockUpdateSource.buildChangelogUrls.mockReturnValue([
    'https://example.com/changelog.json',
  ]);
  fetchMock.mockResolvedValueOnce(
    json({ latestVersion: '9.0.0', entries: [] }),
  );
});
afterAll(() => {
  global.fetch = originalFetch;
});

it('selects the highest strict dev tag and preserves changelog metadata', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ token: 'token' }))
    .mockResolvedValueOnce(
      json({
        tags: [
          'latest',
          'dev',
          '99.0.0',
          'v9.0.0-dev.1',
          '01.0.0-dev.1',
          '1.0.0-dev.1-extra',
          '0.7.2-dev.9',
          '0.7.2-dev.10',
          '0.7.3-dev.1',
          '0.7.2-dev.99',
          null,
        ],
      }),
    );
  const data = await (await GET()).json();
  expect(data).toMatchObject({
    latestVersion: '0.7.3-dev.1',
    changelog: [],
    sources: { branch: 'dev' },
  });
  expect(fetchMock.mock.calls[1][0]).toBe(
    `https://ghcr.io/token?scope=repository%3A${repo.replace('/', '%2F')}%3Apull`,
  );
  expect(fetchMock).toHaveBeenCalledWith(
    tagsUrl,
    expect.objectContaining({
      headers: { Authorization: 'Bearer token' },
      redirect: 'error',
    }),
  );
});

it('follows next links and compares across pages', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ token: 'token' }))
    .mockResolvedValueOnce(
      json(
        { tags: ['0.7.2-dev.6'] },
        { Link: `</v2/${repo}/tags/list?n=1000&last=x>; rel="next"` },
      ),
    )
    .mockResolvedValueOnce(json({ tags: ['0.7.2-dev.7'] }));
  expect(await (await GET()).json()).toMatchObject({
    latestVersion: '0.7.2-dev.7',
  });
  expect(fetchMock.mock.calls[3][0]).toBe(`${tagsUrl}&last=x`);
});

it.each(['token', 'tags', 'invalid', 'empty', 'external', 'limit'])(
  'returns null on %s failure without falling back to stable',
  async (failure) => {
    if (failure === 'token')
      fetchMock.mockRejectedValueOnce(new Error('offline'));
    else {
      fetchMock.mockResolvedValueOnce(json({ token: 'token' }));
      if (failure === 'tags')
        fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
      if (failure === 'invalid')
        fetchMock.mockResolvedValueOnce(json({ tags: 'bad' }));
      if (failure === 'empty')
        fetchMock.mockResolvedValueOnce(json({ tags: ['9.0.0', 'dev'] }));
      if (failure === 'external')
        fetchMock.mockResolvedValueOnce(
          json(
            { tags: ['0.7.2-dev.7'] },
            { Link: '<https://example.com/tags>; rel="next"' },
          ),
        );
      if (failure === 'limit')
        for (let i = 0; i < 5; i++)
          fetchMock.mockResolvedValueOnce(
            json(
              { tags: ['0.7.2-dev.7'] },
              { Link: `<${tagsUrl}&page=${i}>; rel="next"` },
            ),
          );
    }
    expect(await (await GET()).json()).toMatchObject({ latestVersion: null });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(7);
  },
);

it('keeps main on changelog without contacting GHCR', async () => {
  mockUpdateSource.getUpdateBranch.mockReturnValue('main');
  expect(await (await GET()).json()).toMatchObject({ latestVersion: '9.0.0' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('caches the GHCR result between requests', async () => {
  fetchMock
    .mockResolvedValueOnce(json({ token: 'token' }))
    .mockResolvedValueOnce(json({ tags: ['0.7.2-dev.6'] }))
    .mockResolvedValueOnce(json({ latestVersion: '9.0.0', entries: [] }));
  expect(await (await GET()).json()).toMatchObject({
    latestVersion: '0.7.2-dev.6',
  });
  expect(await (await GET()).json()).toMatchObject({
    latestVersion: '0.7.2-dev.6',
  });
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
