export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { setupDevProxy } = await import('@/lib/dev-proxy');
    setupDevProxy();

    const { setupDevCron } = await import('@/lib/cron/dev-scheduler');
    setupDevCron();
  }
}
