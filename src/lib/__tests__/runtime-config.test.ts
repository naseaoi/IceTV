import {
  getSearchSnapshot,
  setSearchSnapshot,
} from '@/features/search/lib/searchSnapshotCache';
import {
  applyClientServerConfig,
  DEFAULT_RUNTIME_CONFIG,
  fetchClientServerConfig,
  getClientAuthRuntimeConfig,
  getCustomCategoryLabel,
  syncClientConfigAfterSave,
} from '@/lib/runtime-config';

const originalFetch = global.fetch;

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(SiteName: string): Response {
  return {
    ok: true,
    json: async () => ({ SiteName, EnableLiveEntry: true }),
  } as Response;
}

function seedSnapshot() {
  setSearchSnapshot('test', {
    results: [],
    totalSources: 1,
    completedSources: 1,
    failedSources: [],
    useFluidSearch: true,
  });
}

describe('runtime config', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    delete window.RUNTIME_CONFIG;
    delete window.__runtimeConfigReady;
  });

  it.each([true, false])(
    '保存后新发请求并隔离旧响应（旧响应先完成：%s）',
    async (oldFirst) => {
      const old = deferredResponse();
      const fresh = deferredResponse();
      const fetchMock = jest
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise);
      global.fetch = fetchMock;
      const beforeSave = fetchClientServerConfig();
      seedSnapshot();
      const synced = syncClientConfigAfterSave();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith('/api/server-config', {
        method: 'GET',
        cache: 'no-store',
      });
      const duringSync = fetchClientServerConfig();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(getSearchSnapshot('test')).toBeNull();

      if (oldFirst) {
        old.resolve(response('旧站点'));
        await Promise.resolve();
        await Promise.resolve();
        expect(window.RUNTIME_CONFIG).toBeUndefined();
      }
      fresh.resolve(response('新站点'));
      await synced;
      old.resolve(response('旧站点'));
      expect(await beforeSave).toMatchObject({ SiteName: '新站点' });
      expect(await duringSync).toMatchObject({ SiteName: '新站点' });
      expect(window.RUNTIME_CONFIG?.ENABLE_LIVE_ENTRY).toBe(true);
    },
  );

  it('同步失败只记录警告并清除搜索快照，保留当前运行配置', async () => {
    const config = applyClientServerConfig({ EnableLiveEntry: true });
    const failure = new Error('offline');
    global.fetch = jest.fn().mockRejectedValueOnce(failure);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    seedSnapshot();

    await expect(syncClientConfigAfterSave()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('刷新客户端运行配置失败:', failure);
    expect(window.RUNTIME_CONFIG).toBe(config);
    expect(getSearchSnapshot('test')).toBeNull();
  });

  it('账号注册入口独立读取 PasswordRegister，缺省关闭', async () => {
    expect(DEFAULT_RUNTIME_CONFIG.PASSWORD_REGISTER).toBe(false);
    applyClientServerConfig({ PasswordRegister: true, LinuxDoLogin: false });
    expect(await getClientAuthRuntimeConfig()).toMatchObject({
      passwordRegister: true,
      linuxDoLogin: false,
    });
    applyClientServerConfig({ PasswordRegister: false, LinuxDoLogin: true });
    expect(await getClientAuthRuntimeConfig()).toMatchObject({
      passwordRegister: false,
      linuxDoLogin: true,
    });
    expect(applyClientServerConfig({}).PASSWORD_REGISTER).toBe(false);
  });

  it('LinuxDo 开关默认关闭并通过运行时配置读取，无首屏请求', async () => {
    expect(DEFAULT_RUNTIME_CONFIG.LINUXDO_LOGIN).toBe(false);
    applyClientServerConfig({ LinuxDoLogin: true });
    expect((await getClientAuthRuntimeConfig()).linuxDoLogin).toBe(true);
    applyClientServerConfig({});
    expect((await getClientAuthRuntimeConfig()).linuxDoLogin).toBe(false);
  });

  it('keeps the server-only filter flag out of client runtime config', () => {
    const payload = { SiteName: 'IceTV', DisableYellowFilter: true };

    expect(DEFAULT_RUNTIME_CONFIG).not.toHaveProperty('DISABLE_YELLOW_FILTER');
    expect(applyClientServerConfig(payload)).not.toHaveProperty(
      'DISABLE_YELLOW_FILTER',
    );
  });

  it('preserves client custom proxy URLs', () => {
    const config = applyClientServerConfig({
      DoubanProxy: 'https://data.example/fetch?url=',
      DoubanImageProxy: 'https://image.example/fetch?url=',
    });

    expect(config.DOUBAN_PROXY).toBe('https://data.example/fetch?url=');
    expect(config.DOUBAN_IMAGE_PROXY).toBe('https://image.example/fetch?url=');
  });

  it('defaults user danmaku off and maps the server switch', () => {
    expect(DEFAULT_RUNTIME_CONFIG.ENABLE_USER_DANMAKU).toBe(false);
    expect(applyClientServerConfig({}).ENABLE_USER_DANMAKU).toBe(false);
    expect(
      applyClientServerConfig({ EnableUserDanmaku: true }).ENABLE_USER_DANMAKU,
    ).toBe(true);
  });

  it('keeps configured numeric runtime values', () => {
    const config = applyClientServerConfig({
      VodPageTimeoutSeconds: 20,
      VodFragmentTimeoutSeconds: 25,
    });

    expect(config.VOD_PAGE_TIMEOUT_SECONDS).toBe(20);
    expect(config.VOD_FRAGMENT_TIMEOUT_SECONDS).toBe(25);
    expect(window.RUNTIME_CONFIG).toEqual(config);
  });

  it('falls back to playback defaults for older server payloads', () => {
    const config = applyClientServerConfig({});

    expect(config.VOD_FRAGMENT_TIMEOUT_SECONDS).toBe(10);
    expect(config.AUTO_SWITCH_SOURCE).toBe(true);
  });

  it('keeps the configured auto source switch default', () => {
    expect(
      applyClientServerConfig({ AutoSwitchSource: false }).AUTO_SWITCH_SOURCE,
    ).toBe(false);
  });

  it('uses the first configured category name as the custom entry label', () => {
    const config = applyClientServerConfig({
      CustomCategories: [
        { name: ' test ', type: 'movie', query: 'test' },
        { name: '剧集', type: 'tv', query: '剧集' },
      ],
    });

    expect(getCustomCategoryLabel(config)).toBe('test');
    expect(getCustomCategoryLabel()).toBe('自定义');
  });
});
