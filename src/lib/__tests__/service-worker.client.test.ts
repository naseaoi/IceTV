import { cleanupDevelopmentServiceWorker } from '../service-worker.client';

describe('development service worker cleanup', () => {
  const originalServiceWorker = Object.getOwnPropertyDescriptor(
    navigator,
    'serviceWorker',
  );
  const originalCaches = Object.getOwnPropertyDescriptor(window, 'caches');

  afterEach(() => {
    window.sessionStorage.clear();
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
    if (originalCaches) {
      Object.defineProperty(window, 'caches', originalCaches);
    } else {
      Reflect.deleteProperty(window, 'caches');
    }
  });

  it('unregisters workers, clears caches and requests one reload', async () => {
    const unregister = jest.fn().mockResolvedValue(true);
    const deleteCache = jest.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: {},
        getRegistrations: jest.fn().mockResolvedValue([{ unregister }]),
      },
    });
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        keys: jest.fn().mockResolvedValue(['precache', 'runtime']),
        delete: deleteCache,
      },
    });

    await expect(cleanupDevelopmentServiceWorker()).resolves.toBe(true);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledWith('precache');
    expect(deleteCache).toHaveBeenCalledWith('runtime');

    await expect(cleanupDevelopmentServiceWorker()).resolves.toBe(false);
  });

  it('cleans stored data without reloading an uncontrolled page', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: null,
        getRegistrations: jest.fn().mockResolvedValue([]),
      },
    });
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        keys: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
      },
    });

    await expect(cleanupDevelopmentServiceWorker()).resolves.toBe(false);
  });
});
