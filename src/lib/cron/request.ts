import * as crypto from 'crypto';

import type { CronTask } from './types';

type HeadersReader = {
  get: (name: string) => string | null;
};

export function parseCronTask(requestUrl: string): CronTask | null {
  const task = new URL(requestUrl).searchParams.get('task');
  if (!task || task === 'all') return 'all';
  if (task === 'config' || task === 'live' || task === 'metadata') {
    return task;
  }
  return null;
}

export function isCronAuthorized(headers: HeadersReader): boolean {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;

  const authorization = headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';

  return safeEqual(token, secret);
}

function safeEqual(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first, 'utf8');
  const secondBuffer = Buffer.from(second, 'utf8');
  if (firstBuffer.length !== secondBuffer.length) {
    crypto.timingSafeEqual(firstBuffer, Buffer.alloc(firstBuffer.length));
    return false;
  }
  return crypto.timingSafeEqual(firstBuffer, secondBuffer);
}
