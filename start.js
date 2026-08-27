#!/usr/bin/env node

const http = require('http');
const path = require('path');

// 调用 generate-manifest.js 生成 manifest.json
function generateManifest() {
  console.log('Generating manifest.json for Docker deployment...');

  try {
    const generateManifestScript = path.join(
      __dirname,
      'scripts',
      'generate-manifest.js',
    );
    require(generateManifestScript);
  } catch (error) {
    console.error('❌ Error calling generate-manifest.js:', error);
    throw error;
  }
}

generateManifest();
warnMissingCronSecret();
warnWeakAuthSecret();

// 直接在当前进程中启动 standalone Server（`server.js`）
require('./server.js');

const READY_POLL_INTERVAL_MS = 1000;
const READY_POLL_TIMEOUT_MS = readPositiveInteger(
  process.env.READY_POLL_TIMEOUT_MS,
  120000,
);
const CRON_INITIAL_DELAY_MS = readPositiveInteger(
  process.env.CRON_INITIAL_DELAY_MS,
  60 * 1000,
);
const CRON_START_STAGGER_MS = readPositiveInteger(
  process.env.CRON_START_STAGGER_MS,
  15 * 1000,
);
const CRON_CONFIG_INTERVAL_MS = readPositiveInteger(
  process.env.CRON_CONFIG_INTERVAL_MS,
  6 * 60 * 60 * 1000,
);
const CRON_LIVE_INTERVAL_MS = readPositiveInteger(
  process.env.CRON_LIVE_INTERVAL_MS,
  60 * 60 * 1000,
);
const CRON_METADATA_INTERVAL_MS = readPositiveInteger(
  process.env.CRON_METADATA_INTERVAL_MS,
  6 * 60 * 60 * 1000,
);

// 每 1 秒轮询一次，直到请求成功
const REQUEST_HOSTNAME = '127.0.0.1';
const HEALTH_PATH = '/api/health';
const TARGET_URL = `http://${REQUEST_HOSTNAME}:${process.env.PORT || 3000}${HEALTH_PATH}`;
const readyPollStartedAt = Date.now();

const intervalId = setInterval(() => {
  if (Date.now() - readyPollStartedAt > READY_POLL_TIMEOUT_MS) {
    console.error(`Server readiness polling timed out: ${TARGET_URL}`);
    clearInterval(intervalId);
    process.exit(1);
    return;
  }

  console.log(`Fetching ${TARGET_URL} ...`);

  const req = http.get(TARGET_URL, (res) => {
    // 当返回 2xx 状态码时认为成功，然后停止轮询
    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
      console.log('Server is up, stop polling.');
      clearInterval(intervalId);
      scheduleCronTasks();
    }

    res.resume();
  });

  req.on('error', (error) => {
    console.warn('Server readiness polling failed:', error.message);
  });

  req.setTimeout(2000, () => {
    req.destroy();
  });
}, READY_POLL_INTERVAL_MS);

function scheduleCronTasks() {
  [
    { task: 'live', intervalMs: CRON_LIVE_INTERVAL_MS },
    { task: 'config', intervalMs: CRON_CONFIG_INTERVAL_MS },
    { task: 'metadata', intervalMs: CRON_METADATA_INTERVAL_MS },
  ].forEach(({ task, intervalMs }, index) => {
    const initialDelay = CRON_INITIAL_DELAY_MS + index * CRON_START_STAGGER_MS;
    console.log(
      `Scheduling ${task} cron in ${initialDelay}ms, interval ${intervalMs}ms`,
    );
    setTimeout(() => {
      executeCronJob(task);
      setInterval(() => executeCronJob(task), intervalMs);
    }, initialDelay);
  });
}

function executeCronJob(task) {
  const hostname = REQUEST_HOSTNAME;
  const port = process.env.PORT || 3000;
  const cronPath = task ? `/api/cron?task=${task}` : '/api/cron';
  const cronUrl = `http://${hostname}:${port}${cronPath}`;
  const cronSecret = getCronSecret();
  const requestOptions = {
    hostname,
    port,
    path: cronPath,
    headers: cronSecret
      ? {
          Authorization: `Bearer ${cronSecret}`,
        }
      : undefined,
  };

  console.log(`Executing cron job: ${cronUrl}`);

  const req = http.get(requestOptions, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Cron job executed successfully:', data);
      } else {
        console.error('Cron job failed:', res.statusCode, data);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Error executing cron job:', err);
  });

  req.setTimeout(30000, () => {
    console.error('Cron job timeout');
    req.destroy();
  });
}

function getCronSecret() {
  return (
    process.env.CRON_SECRET ||
    process.env.ICETV_CRON_SECRET ||
    process.env.VERCEL_CRON_SECRET ||
    ''
  );
}

function warnMissingCronSecret() {
  if (getCronSecret()) {
    return;
  }

  console.warn(
    '⚠️ CRON_SECRET is not configured. Internal cron requests will return 401 until CRON_SECRET, ICETV_CRON_SECRET, or VERCEL_CRON_SECRET is set.',
  );
}

function warnWeakAuthSecret() {
  const secret = getAuthSecret();
  if (secret && secret.length >= 32) {
    return;
  }

  console.warn(
    '⚠️ AUTH_SECRET is missing or shorter than 32 characters. Configure AUTH_SECRET or ICETV_AUTH_SECRET with a high-entropy value.',
  );
}

function getAuthSecret() {
  return process.env.AUTH_SECRET || process.env.ICETV_AUTH_SECRET || '';
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
