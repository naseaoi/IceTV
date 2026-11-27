export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerDisplayText } = await import('@/lib/display-text/server');
    registerDisplayText();

    const { setupDevProxy } = await import('@/lib/dev-proxy');
    setupDevProxy();

    const { setupDevCron } = await import('@/lib/cron/dev-scheduler');
    setupDevCron();
  }
}
