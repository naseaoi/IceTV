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
    previousSkipConfig: {
      enable: true,
      intro_time: 12,
      outro_time: -18,
    },
  };

  it('仅在目标源真正成为当前源后才允许清理旧记录', () => {
    expect(shouldFinalizeSourceSwitchCleanup(task, 'source-a', 'id-a')).toBe(
      false,
    );
    expect(shouldFinalizeSourceSwitchCleanup(task, 'source-b', 'id-b')).toBe(
      true,
    );
  });

  it('在新源开始播放后再删除旧记录并迁移跳过配置', async () => {
    const deletePlayRecord = jest.fn().mockResolvedValue(undefined);
    const deleteSkipConfig = jest.fn().mockResolvedValue(undefined);
    const saveSkipConfig = jest.fn().mockResolvedValue(undefined);

    await finalizeSourceSwitchCleanup(task, {
      deletePlayRecord,
      deleteSkipConfig,
      saveSkipConfig,
    });

    expect(deletePlayRecord).toHaveBeenCalledWith('source-a', 'id-a');
    expect(deleteSkipConfig).toHaveBeenCalledWith('source-a', 'id-a');
    expect(saveSkipConfig).toHaveBeenCalledWith('source-b', 'id-b', {
      enable: true,
      intro_time: 12,
      outro_time: -18,
    });
  });

  it('切集触发的换源会保留上一集的播放记录', async () => {
    const deletePlayRecord = jest.fn().mockResolvedValue(undefined);
    const deleteSkipConfig = jest.fn().mockResolvedValue(undefined);
    const saveSkipConfig = jest.fn().mockResolvedValue(undefined);

    await finalizeSourceSwitchCleanup(
      {
        ...task,
        keepPreviousPlayRecord: true,
      },
      {
        deletePlayRecord,
        deleteSkipConfig,
        saveSkipConfig,
      },
    );

    expect(deletePlayRecord).not.toHaveBeenCalled();
    expect(deleteSkipConfig).toHaveBeenCalledWith('source-a', 'id-a');
    expect(saveSkipConfig).toHaveBeenCalledWith('source-b', 'id-b', {
      enable: true,
      intro_time: 12,
      outro_time: -18,
    });
  });
});
