import { type CronLease, acquireCronLease } from '@/lib/cron-lease';

import { executeCronTask } from './tasks';
import type { CronStartResult, CronTask } from './types';

let cronRunning = false;

export async function startCronTask(task: CronTask): Promise<CronStartResult> {
  if (cronRunning) {
    return createResult(202, task, false, 'Cron job is already running');
  }

  cronRunning = true;
  let lease: CronLease | null;
  try {
    lease = await acquireCronLease();
  } catch (error) {
    cronRunning = false;
    console.error('Cron lease acquisition failed:', error);
    return createResult(503, task, false, 'Cron job lease is unavailable');
  }

  if (!lease) {
    cronRunning = false;
    return createResult(
      202,
      task,
      false,
      'Cron job is already running in another process',
    );
  }

  console.log(`Cron job triggered [${task}]:`, new Date().toISOString());
  void executeCronTask(task)
    .catch((error) => console.error('Cron job background error:', error))
    .finally(() => finishCronTask(lease));

  return createResult(200, task, true, 'Cron job executed successfully');
}

async function finishCronTask(lease: CronLease): Promise<void> {
  try {
    await lease.release();
  } catch (error) {
    console.error('Cron lease release failed:', error);
  } finally {
    cronRunning = false;
  }
}

function createResult(
  status: CronStartResult['status'],
  task: CronTask,
  success: boolean,
  message: string,
): CronStartResult {
  return {
    status,
    payload: {
      success,
      task,
      message,
      timestamp: new Date().toISOString(),
    },
  };
}
