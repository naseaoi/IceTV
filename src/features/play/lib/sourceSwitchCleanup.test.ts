import {
  type SourceSwitchCleanupTask,
  finalizeSourceSwitchCleanup,
  shouldFinalizeSourceSwitchCleanup,
} from '@/features/play/lib/sourceSwitchCleanup';

describe('sourceSwitchCleanup', () => {
  const task: SourceSwitchCleanupTask = {
    previousSource: 'source-a',
    previousId: 'id-a',
    nextSource: 'source-b',
    nextId: 'id-b',
    keepPreviousPlayRecord: false,
    skipConfigCleanupReady: Promise.resolve(true),
  };

  it('仅在目标源真正成为当前源后才允许清理旧记录', () => {
    expect(shouldFinalizeSourceSwitchCleanup(task, 'source-a', 'id-a')).toBe(
      false,
    );
    expect(shouldFinalizeSourceSwitchCleanup(task, 'source-b', 'id-b')).toBe(
      true,
    );
  });

  it.each([true, false])(
    '进度已保存仍等待迁移结果 %s 再决定删除旧配置',
    async (saved) => {
      let resolve!: (value: boolean) => void;
      const skipConfigCleanupReady = new Promise<boolean>((done) => {
        resolve = done;
      });
      const deps = {
        deletePlayRecord: jest.fn().mockResolvedValue(undefined),
        deleteSkipConfig: jest.fn().mockResolvedValue(undefined),
        isCurrentSource: () => true,
      };
      const cleanup = finalizeSourceSwitchCleanup(
        { ...task, skipConfigCleanupReady },
        deps,
      );
      await Promise.resolve();
      expect(deps.deletePlayRecord).toHaveBeenCalledWith('source-a', 'id-a');
      expect(deps.deleteSkipConfig).not.toHaveBeenCalled();
      resolve(saved);
      await cleanup;
      expect(deps.deleteSkipConfig).toHaveBeenCalledTimes(saved ? 1 : 0);
    },
  );

  it('等待迁移期间回退或更换意图时保留旧配置', async () => {
    const deleteSkipConfig = jest.fn();
    await finalizeSourceSwitchCleanup(task, {
      deletePlayRecord: jest.fn().mockResolvedValue(undefined),
      deleteSkipConfig,
      isCurrentSource: () => false,
    });
    expect(deleteSkipConfig).not.toHaveBeenCalled();
  });

  it('在新源进度保存且迁移确认后删除旧记录与旧配置', async () => {
    const deletePlayRecord = jest.fn().mockResolvedValue(undefined);
    const deleteSkipConfig = jest.fn().mockResolvedValue(undefined);
    const isCurrentSource = jest.fn().mockReturnValue(true);

    await finalizeSourceSwitchCleanup(task, {
      deletePlayRecord,
      deleteSkipConfig,
      isCurrentSource,
    });

    expect(deletePlayRecord).toHaveBeenCalledWith('source-a', 'id-a');
    expect(deleteSkipConfig).toHaveBeenCalledWith('source-a', 'id-a');
    expect(isCurrentSource).toHaveBeenCalled();
  });

  it('切集触发的换源会保留上一集的播放记录', async () => {
    const deletePlayRecord = jest.fn().mockResolvedValue(undefined);
    const deleteSkipConfig = jest.fn().mockResolvedValue(undefined);
    const isCurrentSource = jest.fn().mockReturnValue(true);

    await finalizeSourceSwitchCleanup(
      {
        ...task,
        keepPreviousPlayRecord: true,
      },
      {
        deletePlayRecord,
        deleteSkipConfig,
        isCurrentSource,
      },
    );

    expect(deletePlayRecord).not.toHaveBeenCalled();
    expect(deleteSkipConfig).toHaveBeenCalledWith('source-a', 'id-a');
    expect(isCurrentSource).toHaveBeenCalled();
  });
});
