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

  it('treats an unavailable latest version as failure even with stable history', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        latestVersion: null,
        changelog: [{ version: '999.0.0' }],
      }),
    });
    const { checkLatestRelease, UpdateStatus } = loadVersionCheckModule();
    await expect(checkLatestRelease()).resolves.toEqual({
      status: UpdateStatus.FETCH_FAILED,
      latestVersion: null,
    });
  });

  it('throttles failed checks before retrying', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce(createVersionResponse('999.0.0'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { checkLatestRelease, UpdateStatus } = loadVersionCheckModule();
    const checkForUpdates = async () => (await checkLatestRelease()).status;

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
    const { checkLatestRelease, UpdateStatus } = loadVersionCheckModule();
    const checkForUpdates = async () => (await checkLatestRelease()).status;

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
    const { checkLatestRelease, UpdateStatus } = loadVersionCheckModule();
    const checkForUpdates = async () => (await checkLatestRelease()).status;

    await expect(checkForUpdates()).resolves.toBe(UpdateStatus.FETCH_FAILED);

    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps the latest version alongside the cached status', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(createVersionResponse('999.0.0'));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { checkLatestRelease, UpdateStatus } = loadVersionCheckModule();

    await expect(checkLatestRelease()).resolves.toEqual({
      status: UpdateStatus.HAS_UPDATE,
      latestVersion: '999.0.0',
    });

    const refetch = jest.fn();
    global.fetch = refetch as unknown as typeof fetch;
    const reloaded = loadVersionCheckModule();
    await expect(reloaded.checkLatestRelease()).resolves.toEqual({
      status: UpdateStatus.HAS_UPDATE,
      latestVersion: '999.0.0',
    });
    expect(refetch).not.toHaveBeenCalled();
  });

  it('hides the update dot after the latest release is seen', async () => {
    localStorage.clear();
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        createVersionResponse('999.0.0'),
      ) as unknown as typeof fetch;
    const versionCheck = loadVersionCheckModule();
    const onSeen = jest.fn();
    window.addEventListener(versionCheck.RELEASE_SEEN_EVENT, onSeen);

    await expect(versionCheck.checkForUnseenUpdate()).resolves.toBe(true);
    await versionCheck.markLatestReleaseSeen();
    await expect(versionCheck.checkForUnseenUpdate()).resolves.toBe(false);
    expect(onSeen).toHaveBeenCalledTimes(1);
    window.removeEventListener(versionCheck.RELEASE_SEEN_EVENT, onSeen);

    sessionStorage.clear();
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        createVersionResponse('999.1.0'),
      ) as unknown as typeof fetch;
    const newer = loadVersionCheckModule();
    await expect(newer.checkForUnseenUpdate()).resolves.toBe(true);
    localStorage.clear();
  });
});

describe('dev version ordering', () => {
  afterEach(() => {
    jest.dontMock('@/lib/version');
    jest.resetModules();
  });

  const versions = [
    '0.7.2-dev.6',
    '0.7.2-dev.7',
    '0.7.2',
    '0.7.3-dev.1',
    '0.7.3',
  ];
  it.each(versions)('compares %s against every version', (current) => {
    jest.doMock('@/lib/version', () => ({ CURRENT_VERSION: current }));
    const { compareVersions, UpdateStatus } = loadVersionCheckModule();
    for (const remote of versions) {
      expect(compareVersions(remote)).toBe(
        versions.indexOf(remote) > versions.indexOf(current)
          ? UpdateStatus.HAS_UPDATE
          : UpdateStatus.NO_UPDATE,
      );
    }
    expect(compareVersions('invalid')).toBe(UpdateStatus.HAS_UPDATE);
  });

  it('compares dev sequence numbers numerically', () => {
    jest.doMock('@/lib/version', () => ({ CURRENT_VERSION: '0.7.2-dev.9' }));
    const { compareVersions, UpdateStatus } = loadVersionCheckModule();
    expect(compareVersions('0.7.2-dev.10')).toBe(UpdateStatus.HAS_UPDATE);
  });
});
