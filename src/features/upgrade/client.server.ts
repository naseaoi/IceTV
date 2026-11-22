import 'server-only';

import { readJsonLimited } from '@/lib/proxy-response-limits';

import type { UpdaterPhase, UpdaterStatus } from './types';

const phases: readonly UpdaterPhase[] = [
  'idle',
  'pulling',
  'pulled',
  'up-to-date',
  'restarting',
  'verifying',
  'succeeded',
  'rolling-back',
  'rolled-back',
  'failed',
];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid updater response');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) {
    throw new Error('Invalid updater text');
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

export function normalizeUpdaterStatus(value: unknown): UpdaterStatus {
  const input = object(value);
  const job = object(input.job);
  if (
    typeof input.capable !== 'boolean' ||
    !phases.includes(job.phase as UpdaterPhase)
  ) {
    throw new Error('Invalid updater status');
  }
  const status: UpdaterStatus = {
    capable: input.capable,
    job: { phase: job.phase as UpdaterPhase },
  };
  if (input.reason !== undefined) status.reason = text(input.reason);
  if (job.message !== undefined) status.job.message = text(job.message);
  if (job.pulledVersion !== undefined) {
    status.job.pulledVersion =
      job.pulledVersion === null ? null : text(job.pulledVersion);
  }
  for (const key of ['startedAt', 'updatedAt'] as const) {
    if (job[key] !== undefined) {
      if (
        typeof job[key] !== 'number' ||
        !Number.isSafeInteger(job[key]) ||
        job[key] < 0
      ) {
        throw new Error('Invalid updater timestamp');
      }
      status.job[key] = job[key];
    }
  }
  if (input.target !== undefined) {
    const target = object(input.target);
    status.target = {
      container: text(target.container),
      project: text(target.project),
      service: text(target.service),
      image: text(target.image),
      currentVersion:
        target.currentVersion === null ? null : text(target.currentVersion),
    };
  }
  return status;
}

export function isUpdaterConfigured(): boolean {
  return Boolean(
    process.env.UPDATER_URL?.trim() && process.env.UPDATER_TOKEN?.trim(),
  );
}

export class UpdaterConflictError extends Error {
  constructor() {
    super('升级任务状态已变化或已有任务进行中，请刷新后重试');
    this.name = 'UpdaterConflictError';
  }
}

export async function requestUpdater(
  action: 'status' | 'pull' | 'restart',
): Promise<UpdaterStatus> {
  if (!isUpdaterConfigured()) throw new Error('Updater is not configured');
  const url = new URL(process.env.UPDATER_URL!.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Invalid updater URL');
  }
  url.pathname = `/${action}`;
  url.search = '';
  url.hash = '';
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    action === 'status' ? 5000 : 15000,
  );
  try {
    // 部署者配置的内网控制面地址，不走拒绝私网地址的普通回源边界。
    const response = await fetch(url, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${process.env.UPDATER_TOKEN!.trim()}` },
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 409) throw new UpdaterConflictError();
      throw new Error(`Updater HTTP ${response.status}`);
    }
    return normalizeUpdaterStatus(await readJsonLimited(response, 64 * 1024));
  } finally {
    clearTimeout(timeout);
  }
}
