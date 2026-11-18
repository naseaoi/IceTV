import { bindCatalogFavorites, saveFavorite } from './db.client';
import {
  cacheManager,
  fetchFromApi,
  fetchWithAuth,
} from './db.client.internal';

let mockUsername = 'alice';
jest.mock('@/lib/auth.client', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: mockUsername }),
}));
jest.mock('@/lib/db.client.internal', () => ({
  cacheManager: { cacheFavorites: jest.fn() },
  createCacheFirstReader: jest.fn(),
  createKeyedCacheFirstReader: jest.fn(),
  createKeyedNetworkReader: jest.fn(),
  createOptimisticWriter: jest.fn(),
  fetchFromApi: jest.fn(async () => ({})),
  fetchWithAuth: jest.fn(),
  handleDatabaseOperationFailure: jest.fn(),
  retryClientRequest: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

it('runs a batch once per user in the tab and refreshes on bound results', async () => {
  mockUsername = 'batch-user';
  (fetchWithAuth as jest.Mock).mockResolvedValue({
    json: async () => ({ results: [{ status: 'bound', key: 'src+1' }] }),
  });
  const refresh = jest.fn();
  window.addEventListener('favoritesUpdated', refresh);
  try {
    await bindCatalogFavorites();
    await bindCatalogFavorites();
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(fetchFromApi).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener('favoritesUpdated', refresh);
  }
});

it('starts a keyed background binding after catalog save', async () => {
  mockUsername = 'save-user';
  (fetchWithAuth as jest.Mock)
    .mockResolvedValueOnce({ json: async () => ({ key: 'douban+1' }) })
    .mockResolvedValueOnce({
      json: async () => ({ status: 'skipped', key: 'douban+1' }),
    });
  await expect(
    saveFavorite('douban', '1', {
      title: 'Show',
      year: '2026',
      total_episodes: 0,
      source_name: '豆瓣',
      cover: '',
      save_time: 1,
    }),
  ).resolves.toBe('douban+1');
  expect(fetchWithAuth).toHaveBeenLastCalledWith(
    '/api/favorites/catalog-bind',
    expect.objectContaining({ body: JSON.stringify({ key: 'douban+1' }) }),
  );
});

it('silently ignores binding failures and does not refresh', async () => {
  mockUsername = 'failed-user';
  (fetchWithAuth as jest.Mock).mockRejectedValue(new Error('network'));
  await expect(bindCatalogFavorites('douban+1')).resolves.toBeUndefined();
  expect(fetchFromApi).not.toHaveBeenCalled();
});

it('ignores a bound response after account switching', async () => {
  mockUsername = 'first';
  (fetchWithAuth as jest.Mock).mockImplementation(async () => {
    mockUsername = 'second';
    return { json: async () => ({ status: 'bound' }) };
  });
  await bindCatalogFavorites('douban+1');
  expect(cacheManager.cacheFavorites).not.toHaveBeenCalled();
});
