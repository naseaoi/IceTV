function loadVersionCheckModule() {
  jest.resetModules();
  return require('../version-check') as typeof import('../version-check.js');
}

function createVersionResponse(version: string) {
  return {
    ok: true,
    json: async () => ({ latestVersion: version }),
  };
}

function createStorageMock(initialData: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initialData));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
  };
}

describe('version check', () => {
  const originalFetch = global.fetch;
  const originalSessionStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    'sessionStorage',
  );

  beforeEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: createStorageMock(),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalSessionStorage) {
      Object.defineProperty(
        globalThis,
        'sessionStorage',
        originalSessionStorage,
      );
    } else {
      Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('throttles failed checks before retrying', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(createVersionResponse('999.0.0'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { checkForUpdates, UpdateStatus } = loadVersionCheckModule();

    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.FETCH_FAILED);
    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.FETCH_FAILED);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now += 60_001;

    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.HAS_UPDATE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses successful checks in the current session', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(createVersionResponse('999.0.0'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { checkForUpdates, UpdateStatus } = loadVersionCheckModule();

    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.HAS_UPDATE);
    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.HAS_UPDATE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses pending checks from session storage', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: createStorageMock({
        'icetv:version-check': JSON.stringify({
          status: 'pending',
          checkedAt: 2_000,
        }),
      }),
    });
    jest.spyOn(Date, 'now').mockReturnValue(3_000);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { checkForUpdates, UpdateStatus } = loadVersionCheckModule();

    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.FETCH_FAILED);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
