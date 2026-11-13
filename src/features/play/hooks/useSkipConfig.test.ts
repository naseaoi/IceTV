import { act, renderHook } from '@testing-library/react';
import type Artplayer from 'artplayer';

import {
  deleteSkipConfig,
  getSkipConfig,
  saveSkipConfig,
} from '@/lib/db.client';
import { showToast } from '@/lib/toast';

import { useSkipConfig } from './useSkipConfig';

jest.mock('@/lib/db.client', () => ({
  deleteSkipConfig: jest.fn(),
  getSkipConfig: jest.fn(),
  saveSkipConfig: jest.fn(),
  subscribeToDataUpdates: (
    event: string,
    callback: (data: unknown) => void,
  ) => {
    const handler = (e: Event) => callback((e as CustomEvent).detail);
    window.addEventListener(event, handler);
    return () => window.removeEventListener(event, handler);
  },
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
const initial = { enable: false, intro_time: 0, outro_time: 0 };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getSkipConfig).mockReset().mockResolvedValue(initial);
  jest.mocked(saveSkipConfig).mockReset().mockResolvedValue(undefined);
  jest.mocked(deleteSkipConfig).mockReset().mockResolvedValue(undefined);
});

const carried = { enable: true, intro_time: 12, outro_time: -18 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setupMigration() {
  const currentSourceRef = { current: 'old' };
  const currentIdRef = { current: '1' };
  const skipConfigRef = { current: initial };
  const update = jest.fn();
  const options = {
    currentSourceRef,
    currentIdRef,
    skipConfigRef,
    artPlayerRef: { current: { setting: { update } } as unknown as Artplayer },
    setSkipConfig: jest.fn(),
  };
  const hook = renderHook(
    ({ source }) =>
      useSkipConfig({
        ...options,
        currentSource: source,
        currentId: '1',
      }),
    { initialProps: { source: 'old' } },
  );
  const move = (source: string) => {
    currentSourceRef.current = source;
    hook.rerender({ source });
  };
  return { ...hook, ...options, update, move };
}

it('新源无配置时立即同步 ref、state 与面板，保存成功前即生效', async () => {
  const hook = setupMigration();
  await act(async () => {});
  const saving = deferred<void>();
  jest.mocked(getSkipConfig).mockResolvedValue(null);
  jest.mocked(saveSkipConfig).mockReturnValueOnce(saving.promise);
  const ready = hook.result.current.registerSkipConfigMigration(
    'new',
    '1',
    carried,
  );
  await act(async () => {
    hook.move('new');
  });
  expect(hook.skipConfigRef.current).toEqual(carried);
  expect(hook.setSkipConfig).toHaveBeenLastCalledWith(carried);
  expect(hook.update).toHaveBeenCalledWith(
    expect.objectContaining({ name: '跳过片头片尾', switch: true }),
  );
  expect(hook.update).toHaveBeenCalledWith(
    expect.objectContaining({ name: '设置片头', tooltip: '00:12' }),
  );
  expect(saveSkipConfig).toHaveBeenCalledWith('new', '1', carried);
  await act(async () => {
    saving.resolve();
    expect(await ready).toBe(true);
  });
});

it.each([carried, initial])(
  '新源已有自己的配置时保留该配置 %j',
  async (own) => {
    const hook = setupMigration();
    await act(async () => {});
    jest.mocked(getSkipConfig).mockResolvedValue(own);
    const ready = hook.result.current.registerSkipConfigMigration('new', '1', {
      ...carried,
      intro_time: 30,
    });
    await act(async () => {
      hook.move('new');
    });
    expect(await ready).toBe(true);
    expect(hook.skipConfigRef.current).toEqual(own);
    expect(saveSkipConfig).not.toHaveBeenCalled();
    expect(deleteSkipConfig).not.toHaveBeenCalled();
  },
);

it('旧配置为空时只加载新源配置，保持新源已有值且不删除旧源配置', async () => {
  const hook = setupMigration();
  await act(async () => {});
  jest.mocked(getSkipConfig).mockResolvedValue(carried);
  const ready = hook.result.current.registerSkipConfigMigration(
    'new',
    '1',
    initial,
  );
  await act(async () => {
    hook.move('new');
  });
  expect(await ready).toBe(false);
  expect(hook.skipConfigRef.current).toEqual(carried);
  expect(saveSkipConfig).not.toHaveBeenCalled();
  expect(deleteSkipConfig).not.toHaveBeenCalled();
});

it.each([true, false])(
  '迁移在途时用户修改优先，迁移成功=%s',
  async (success) => {
    const hook = setupMigration();
    await act(async () => {});
    const saving = deferred<void>();
    jest.mocked(getSkipConfig).mockResolvedValue(null);
    jest.mocked(saveSkipConfig).mockReturnValueOnce(saving.promise);
    const ready = hook.result.current.registerSkipConfigMigration(
      'new',
      '1',
      carried,
    );
    await act(async () => {
      hook.move('new');
    });
    const edited = { ...carried, intro_time: 40 };
    let userSave!: Promise<void>;
    await act(async () => {
      userSave = hook.result.current.handleSkipConfigChange(edited);
    });
    expect(saveSkipConfig).toHaveBeenCalledTimes(1);
    await act(async () => {
      if (success) saving.resolve();
      else saving.reject(new Error('offline'));
      await userSave;
    });
    expect(await ready).toBe(success);
    expect(saveSkipConfig).toHaveBeenNthCalledWith(2, 'new', '1', edited);
    expect(hook.skipConfigRef.current).toEqual(edited);
    expect(hook.setSkipConfig).toHaveBeenLastCalledWith(edited);
    expect(showToast).not.toHaveBeenCalled();
  },
);

it('新源读取晚到时保留用户已修改的配置，放弃迁移', async () => {
  const hook = setupMigration();
  await act(async () => {});
  const reading = deferred<null>();
  jest.mocked(getSkipConfig).mockReturnValueOnce(reading.promise);
  const ready = hook.result.current.registerSkipConfigMigration(
    'new',
    '1',
    carried,
  );
  await act(async () => {
    hook.move('new');
  });
  const edited = { ...carried, intro_time: 50 };
  await act(async () => {
    await hook.result.current.handleSkipConfigChange(edited);
  });
  await act(async () => {
    reading.resolve(null);
  });
  expect(await ready).toBe(false);
  expect(saveSkipConfig).toHaveBeenCalledTimes(1);
  expect(saveSkipConfig).toHaveBeenCalledWith('new', '1', edited);
  expect(hook.skipConfigRef.current).toEqual(edited);
});

it('迁移保存失败时静默回滚新源并保留旧源清理资格为 false', async () => {
  const hook = setupMigration();
  await act(async () => {});
  jest.mocked(getSkipConfig).mockResolvedValue(null);
  jest.mocked(saveSkipConfig).mockRejectedValueOnce(new Error('offline'));
  const ready = hook.result.current.registerSkipConfigMigration(
    'new',
    '1',
    carried,
  );
  await act(async () => {
    hook.move('new');
  });
  expect(await ready).toBe(false);
  expect(hook.skipConfigRef.current).toEqual(initial);
  expect(showToast).not.toHaveBeenCalled();
});

it('新源读取期间退回旧源，迟到的读取不写入迁移', async () => {
  const hook = setupMigration();
  await act(async () => {});
  const reading = deferred<null>();
  jest.mocked(getSkipConfig).mockReturnValueOnce(reading.promise);
  const ready = hook.result.current.registerSkipConfigMigration(
    'new',
    '1',
    carried,
  );
  await act(async () => {
    hook.move('new');
  });
  await act(async () => {
    hook.move('old');
    reading.resolve(null);
  });
  expect(await ready).toBe(false);
  expect(saveSkipConfig).not.toHaveBeenCalled();
  expect(hook.skipConfigRef.current).toEqual(initial);
});

it('迁移排队尚未写入时用户修改使迁移失效', async () => {
  const hook = setupMigration();
  await act(async () => {});
  const reading = deferred<null>();
  jest.mocked(getSkipConfig).mockReturnValueOnce(reading.promise);
  const ready = hook.result.current.registerSkipConfigMigration(
    'new',
    '1',
    carried,
  );
  await act(async () => {
    hook.move('new');
  });
  const edited = { ...carried, intro_time: 60 };
  await act(async () => {
    reading.resolve(null);
    // 读取回调已应用迁移，但队列的微任务还未开始写入。
    await Promise.resolve();
    await hook.result.current.handleSkipConfigChange(edited);
  });
  expect(await ready).toBe(false);
  expect(saveSkipConfig).toHaveBeenCalledTimes(1);
  expect(saveSkipConfig).toHaveBeenCalledWith('new', '1', edited);
  expect(hook.skipConfigRef.current).toEqual(edited);
});

it('已发出的迁移保存完成时源已回退，保持旧源状态且取消清理资格', async () => {
  const hook = setupMigration();
  await act(async () => {});
  const saving = deferred<void>();
  jest.mocked(getSkipConfig).mockResolvedValue(null);
  jest.mocked(saveSkipConfig).mockReturnValueOnce(saving.promise);
  const ready = hook.result.current.registerSkipConfigMigration(
    'new',
    '1',
    carried,
  );
  await act(async () => {
    hook.move('new');
  });
  await act(async () => {
    hook.move('old');
  });
  await act(async () => {
    saving.resolve();
  });
  expect(await ready).toBe(false);
  expect(hook.skipConfigRef.current).toEqual(initial);
  expect(deleteSkipConfig).not.toHaveBeenCalled();
});

it('同键提交串行，前次失败不撤销最新操作，最新失败回到最后确认值', async () => {
  let rejectFirst!: (error: Error) => void;
  jest
    .mocked(saveSkipConfig)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new TypeError('offline'));
  const skipConfigRef = { current: initial };
  const setSkipConfig = jest.fn();
  const { result } = renderHook(() =>
    useSkipConfig({
      currentSource: 's',
      currentId: '1',
      currentSourceRef: { current: 's' },
      currentIdRef: { current: '1' },
      skipConfigRef,
      artPlayerRef: { current: null as Artplayer | null },
      setSkipConfig,
    }),
  );
  await act(async () => {});
  expect(getSkipConfig).toHaveBeenCalledWith('s', '1');
  const first = { ...initial, intro_time: 10 };
  const second = { ...initial, intro_time: 20 };
  let pending!: Promise<void>;
  await act(async () => {
    void result.current.handleSkipConfigChange(first);
    pending = result.current.handleSkipConfigChange(second);
    await Promise.resolve();
  });
  expect(saveSkipConfig).toHaveBeenCalledTimes(1);
  expect(skipConfigRef.current).toEqual(second);
  await act(async () => {
    rejectFirst(new Error('failed'));
    await pending;
  });
  expect(saveSkipConfig).toHaveBeenCalledTimes(2);
  expect(skipConfigRef.current).toEqual(second);
  await act(async () => {
    await result.current.handleSkipConfigChange({ ...initial, intro_time: 30 });
  });
  expect(skipConfigRef.current).toEqual(second);
  expect(showToast).toHaveBeenCalledTimes(2);
  expect(deleteSkipConfig).not.toHaveBeenCalled();
});

function emitSkipConfigs(configs: Record<string, typeof initial>) {
  window.dispatchEvent(
    new CustomEvent('skipConfigsUpdated', { detail: configs }),
  );
}

it('后台核对到其他设备的新配置时同步到当前播放器', async () => {
  const hook = setupMigration();
  await act(async () => {});
  act(() => emitSkipConfigs({ 'old+1': carried }));
  expect(hook.skipConfigRef.current).toEqual(carried);
  act(() => emitSkipConfigs({}));
  expect(hook.skipConfigRef.current).toEqual(initial);
});

it('本页已修改配置后不再被后台核对结果覆盖', async () => {
  const hook = setupMigration();
  await act(async () => {});
  const mine = { enable: true, intro_time: 5, outro_time: 0 };
  await act(async () => {
    await hook.result.current.handleSkipConfigChange(mine);
  });
  act(() => emitSkipConfigs({ 'old+1': carried }));
  expect(hook.skipConfigRef.current).toEqual(mine);
});
