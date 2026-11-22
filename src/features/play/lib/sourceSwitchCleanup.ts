export interface SourceSwitchCleanupTask {
  previousSource: string;
  previousId: string;
  nextSource: string;
  nextId: string;
  skipConfigCleanupReady: Promise<boolean>;
  keepPreviousPlayRecord?: boolean;
}

interface SourceSwitchCleanupDeps {
  deleteSkipConfig: (source: string, id: string) => Promise<void>;
  isCurrentSource: () => boolean;
}

/**
 * 新源进度成功保存后，才允许清理旧源数据，
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

export async function finalizeSourceSwitchCleanup(
  task: SourceSwitchCleanupTask,
  deps: SourceSwitchCleanupDeps,
) {
  try {
    if (!(await task.skipConfigCleanupReady) || !deps.isCurrentSource()) return;
    await deps.deleteSkipConfig(task.previousSource, task.previousId);
  } catch (err) {
    console.error('清除旧源跳过片头片尾配置失败:', err);
  }
}
