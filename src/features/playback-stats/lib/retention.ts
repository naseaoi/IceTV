export const PLAYBACK_RETENTION_BATCH_SIZE = 500;
const PLAYBACK_RETENTION_BUDGET_MS = 1000;

// 预算只在短事务之间检查；已提交的批次保留，下轮从剩余过期行继续。
export async function runPlaybackRetention(
  deleteBatch: () => Promise<number>,
  budgetMs = PLAYBACK_RETENTION_BUDGET_MS,
): Promise<number> {
  const deadline = performance.now() + budgetMs;
  let deleted = 0;
  while (performance.now() < deadline) {
    const count = await deleteBatch();
    deleted += count;
    if (count < PLAYBACK_RETENTION_BATCH_SIZE) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return deleted;
}
