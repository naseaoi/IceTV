export type CronTask = 'all' | 'config' | 'live' | 'metadata' | 'source-health';

export type CronStartResult = {
  status: 200 | 202 | 503;
  payload: {
    success: boolean;
    task: CronTask;
    message: string;
    timestamp: string;
  };
};
