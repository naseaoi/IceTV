export interface SourceSwitchCleanupTask {
  previousSource: string;
  previousId: string;
  nextSource: string;
  nextId: string;
  skipConfigCleanupReady: Promise<boolean>;
  keepPreviousPlayRecord?: boolean;
}

interface SourceSwitchCleanupDeps {
  deletePlayRecord: (source: string, id: string) => Promise<void>;
  deleteSkipConfig: (source: string, id: string) => Promise<void>;
  isCurrentSource: () => boolean;
}

/**
 * 新源进度成功保存后，才允许清理旧记录，
 * 避免自动播放被拒绝或保存失败时丢失继续观看记录。
 */
export function shouldFinalizeSourceSwitchCleanup(
  task: SourceSwitchCleanupTask | null,
  activeSource: string,
  activeId: string,
): task is SourceSwitchCleanupTask {
  if (!task) {
    return false;
  }

  return task.nextSource === activeSource && task.nextId === activeId;
}

/**
 * 新源记录落库后清理旧记录，跳过配置另外等待迁移结果。
 */
export async function finalizeSourceSwitchCleanup(
  task: SourceSwitchCleanupTask,
  deps: SourceSwitchCleanupDeps,
) {
  if (!task.keepPreviousPlayRecord) {
    try {
      await deps.deletePlayRecord(task.previousSource, task.previousId);
    } catch (err) {
      console.error('清除播放记录失败:', err);
    }
  }

  try {
    if (!(await task.skipConfigCleanupReady) || !deps.isCurrentSource()) return;
    await deps.deleteSkipConfig(task.previousSource, task.previousId);
  } catch (err) {
    console.error('清除旧源跳过片头片尾配置失败:', err);
  }
}
