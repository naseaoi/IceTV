import { startCronTask } from '@/lib/cron/runner';
import type { CronTask } from '@/lib/cron/types';

const DEFAULT_INITIAL_DELAY_MS = 30 * 1000;
const DEFAULT_STAGGER_MS = 15 * 1000;
const DEFAULT_METADATA_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_LIVE_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_CONFIG_INTERVAL_MS = 6 * 60 * 60 * 1000;

let scheduled = false;

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function runTask(task: CronTask): Promise<void> {
  try {
    const result = await startCronTask(task);
    console.log(`[dev-cron] ${task}: ${result.payload.message}`);
  } catch (error) {
    console.error(`[dev-cron] ${task} 执行失败:`, error);
  }
}

/**
 * `next dev` 不经过 start.js，本地开发没有任何定时任务，追更集数永远不会自动刷新。
 * 这里在开发环境内进程调度，生产环境仍由 start.js / 平台 cron 负责。
 */
export function setupDevCron(): void {
  if (scheduled) return;
  if (process.env.NODE_ENV === 'production') return;
  if (process.env.DEV_CRON_DISABLED === 'true') return;

  scheduled = true;

  const tasks: Array<{ task: CronTask; intervalMs: number }> = [
    {
      task: 'metadata',
      intervalMs: readPositiveInteger(
        process.env.CRON_METADATA_INTERVAL_MS,
        DEFAULT_METADATA_INTERVAL_MS,
      ),
    },
    {
      task: 'live',
      intervalMs: readPositiveInteger(
        process.env.CRON_LIVE_INTERVAL_MS,
        DEFAULT_LIVE_INTERVAL_MS,
      ),
    },
    {
      task: 'config',
      intervalMs: readPositiveInteger(
        process.env.CRON_CONFIG_INTERVAL_MS,
        DEFAULT_CONFIG_INTERVAL_MS,
      ),
    },
  ];

  const initialDelayMs = readPositiveInteger(
    process.env.DEV_CRON_INITIAL_DELAY_MS,
    DEFAULT_INITIAL_DELAY_MS,
  );

  tasks.forEach(({ task, intervalMs }, index) => {
    const delay = initialDelayMs + index * DEFAULT_STAGGER_MS;
    console.log(
      `[dev-cron] 调度 ${task}: ${delay}ms 后首次执行，周期 ${intervalMs}ms`,
    );

    setTimeout(() => {
      void runTask(task);
      setInterval(() => void runTask(task), intervalMs).unref();
    }, delay).unref();
  });
}
