const PRUNE_BATCH_SIZE = 500;
const PRUNE_MAX_BATCHES = 20;
const PRUNE_BUDGET_MS = 200;

export async function pruneResourceBatches(
  pruneBatch: (limit: number) => Promise<number>,
): Promise<void> {
  const startedAt = Date.now();
  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch += 1) {
    const deleted = await pruneBatch(PRUNE_BATCH_SIZE);
    if (deleted < PRUNE_BATCH_SIZE || Date.now() - startedAt >= PRUNE_BUDGET_MS)
      break;
  }
}

export interface ResourceAdmission {
  allowed: boolean;
  retryAfterMs: number;
}

export interface SharedResourceStore {
  getCooldown(key: string): Promise<number>;
  extendCooldown(key: string, until: number): Promise<number>;
  consume(
    key: string,
    amount: number,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<ResourceAdmission>;
  acquire(
    key: string,
    token: string,
    limit: number,
    now: number,
    until: number,
  ): Promise<ResourceAdmission>;
  renew(
    key: string,
    token: string,
    now: number,
    until: number,
  ): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
  prune(now: number): Promise<void>;
}
