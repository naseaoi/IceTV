import 'server-only';

import { createHash } from 'node:crypto';

import { createThrottledMaintenance, withTimeout } from '@/lib/concurrency';
import { db } from '@/lib/db';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import type { SharedResourceStore } from '@/lib/shared-resource-store';

const WINDOW_MS = 60_000;
// 每个窗口约分 64 块向数据库预约；限额很小时块退化为 1 个单位，等同逐次写库
const BLOCKS_PER_WINDOW = 64;
const QUOTA_BLOCKS = {
  requests: { granularity: 1, maxBlock: 64 },
  bytes: { granularity: 256 * 1024, maxBlock: 8 * 1024 * 1024 },
} as const;
// 单个 store 的池条目上限，满时淘汰最久未用的条目并放弃其余额
const MAX_POOLS_PER_STORE = 4096;
// 半开连接上的预约可能十几分钟不返回；超时按数据库出错处理，迟到的结果不计入余额
// 须短于连接租约续期间隔（10 秒）：回源准入先占租约再预约请求数，预约完成后才开始续租
const REFILL_TIMEOUT_MS = 3_000;

export type SharedQuotaUnit = keyof typeof QUOTA_BLOCKS;

interface QuotaPool {
  // 余额所属数据库窗口的结束时刻，窗口重置后余额作废
  resetAt: number;
  balance: number;
  // 本窗口被拒的最小预约量：窗口内用量只增不减，不小于它的预约必然被拒
  refused: number;
  refill?: Promise<boolean>;
}

const quotaPools = new WeakMap<SharedResourceStore, Map<string, QuotaPool>>();
const schedulePrune = createThrottledMaintenance(60_000);
let lastSweepAt = 0;

export function resourceKey(scope: string, identity: string): string {
  return `${scope}:${createHash('sha256').update(identity).digest('hex')}`;
}

export async function sharedResourceStore(): Promise<SharedResourceStore> {
  try {
    const store = await db.getSharedResourceStore();
    schedulePrune(() => store.prune(Date.now()));
    return store;
  } catch {
    throw new ResourceLimitError();
  }
}

// 计数型额度在进程内扣减，余额不足时才向数据库预约；先预约后放行，实例间时钟同步时不会超发
export async function consumeSharedQuota(
  store: SharedResourceStore,
  key: string,
  amount: number,
  limit: number,
  status: 429 | 503 = 503,
  unit: SharedQuotaUnit = 'requests',
): Promise<void> {
  const pool = quotaPool(store, key);
  const { granularity } = QUOTA_BLOCKS[unit];
  let storeFailed = false;
  for (;;) {
    const now = Date.now();
    if (now >= pool.resetAt) {
      pool.balance = 0;
      pool.refused = Infinity;
    }
    if (pool.balance >= amount) {
      pool.balance -= amount;
      return;
    }
    if (storeFailed) throw new ResourceLimitError();
    const shortfall =
      Math.ceil((amount - pool.balance) / granularity) * granularity;
    if (shortfall >= pool.refused)
      throw new ResourceLimitError(status, (pool.resetAt - now) / 1000);
    // 同一个池同时只有一次在途预约，其余请求等它完成后重新检查余额
    if (!pool.refill) {
      const refill = refillPool(store, key, pool, shortfall, limit, unit);
      pool.refill = refill.finally(() => {
        pool.refill = undefined;
      });
    }
    storeFailed = !(await pool.refill);
  }
}

// 先预约一整块，整块被拒时按实际缺口再试一次；数据库出错或超时返回 false
async function refillPool(
  store: SharedResourceStore,
  key: string,
  pool: QuotaPool,
  shortfall: number,
  limit: number,
  unit: SharedQuotaUnit,
): Promise<boolean> {
  const { granularity, maxBlock } = QUOTA_BLOCKS[unit];
  const block = Math.min(
    maxBlock,
    Math.max(
      granularity,
      Math.floor(limit / BLOCKS_PER_WINDOW / granularity) * granularity,
    ),
  );
  try {
    for (const amount of shortfall < block ? [block, shortfall] : [shortfall]) {
      const now = Date.now();
      if (now < pool.resetAt && amount >= pool.refused) continue;
      const result = await withTimeout(
        store.consume(key, amount, limit, WINDOW_MS, now),
        REFILL_TIMEOUT_MS,
        '共享额度预约超时',
      );
      // retryAfterMs 即 resetAt - now，据此识别数据库窗口是否已重置
      const resetAt = now + result.retryAfterMs;
      if (resetAt !== pool.resetAt) {
        pool.resetAt = resetAt;
        pool.balance = 0;
        pool.refused = Infinity;
      }
      if (result.allowed) {
        pool.balance += amount;
        return true;
      }
      pool.refused = Math.min(pool.refused, amount);
    }
    return true;
  } catch {
    return false;
  }
}

function quotaPool(store: SharedResourceStore, key: string): QuotaPool {
  let pools = quotaPools.get(store);
  if (!pools) {
    pools = new Map();
    quotaPools.set(store, pools);
  }
  let pool = pools.get(key);
  if (pool) {
    pools.delete(key);
  } else {
    sweepExpiredPools(pools);
    if (pools.size >= MAX_POOLS_PER_STORE)
      pools.delete(pools.keys().next().value!);
    pool = { resetAt: 0, balance: 0, refused: Infinity };
  }
  // Map 按插入顺序迭代，重新插入使最久未用的条目始终在最前
  pools.set(key, pool);
  return pool;
}

function sweepExpiredPools(pools: Map<string, QuotaPool>) {
  const now = Date.now();
  if (now - lastSweepAt < WINDOW_MS) return;
  lastSweepAt = now;
  for (const [key, pool] of pools)
    if (now >= pool.resetAt && !pool.refill) pools.delete(key);
}
