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
        deleteSkipConfig: jest.fn().mockResolvedValue(undefined),
        isCurrentSource: () => true,
      };
      const cleanup = finalizeSourceSwitchCleanup(
        { ...task, skipConfigCleanupReady },
        deps,
      );
      await Promise.resolve();
      expect(deps.deleteSkipConfig).not.toHaveBeenCalled();
      resolve(saved);
      await cleanup;
      expect(deps.deleteSkipConfig).toHaveBeenCalledTimes(saved ? 1 : 0);
    },
  );

  it('等待迁移期间回退或更换意图时保留旧配置', async () => {
    const deleteSkipConfig = jest.fn();
    await finalizeSourceSwitchCleanup(task, {
      deleteSkipConfig,
      isCurrentSource: () => false,
    });
    expect(deleteSkipConfig).not.toHaveBeenCalled();
  });
});
