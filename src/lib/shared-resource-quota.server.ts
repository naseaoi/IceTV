import 'server-only';

import { createHash } from 'node:crypto';

import { db } from '@/lib/db';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import type { SharedResourceStore } from '@/lib/shared-resource-store';

let lastPruneAt = 0;

export function resourceKey(scope: string, identity: string): string {
  return `${scope}:${createHash('sha256').update(identity).digest('hex')}`;
}

export async function sharedResourceStore(): Promise<SharedResourceStore> {
  try {
    const store = await db.getSharedResourceStore();
    const now = Date.now();
    if (now - lastPruneAt >= 60_000) {
      lastPruneAt = now;
      await store.prune(now);
    }
    return store;
  } catch {
    throw new ResourceLimitError();
  }
}

export async function consumeSharedQuota(
  store: SharedResourceStore,
  key: string,
  amount: number,
  limit: number,
  status: 429 | 503 = 503,
) {
  try {
    const result = await store.consume(key, amount, limit, 60_000, Date.now());
    if (!result.allowed)
      throw new ResourceLimitError(status, result.retryAfterMs / 1000);
  } catch (error) {
    if (error instanceof ResourceLimitError) throw error;
    throw new ResourceLimitError();
  }
}
