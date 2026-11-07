import {
  type SourceSelectionContext,
  EMPTY_SOURCE_SELECTION_CONTEXT,
} from '@/features/play/lib/sourceRoutePreference';
import { withAbortableTimeout } from '@/lib/concurrency';
import { getProxyModes } from '@/lib/proxy-modes';
import {
  type SourceHealthTier,
  SOURCE_HEALTH_TIER_PRIORITY,
} from '@/lib/source-quality-policy';

const CONTEXT_TTL_MS = 60_000;

let cached: { value: SourceSelectionContext; expiresAt: number } | null = null;
let inflight: Promise<SourceSelectionContext> | null = null;

async function loadHealthTiers(): Promise<Record<string, SourceHealthTier>> {
  try {
    return await withAbortableTimeout(
      async (signal) => {
        const response = await fetch('/api/source-selection', { signal });
        if (!response.ok) return {};
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
        return Object.fromEntries(
          Object.entries(data).filter(
            ([, tier]) =>
              typeof tier === 'string' &&
              Object.hasOwn(SOURCE_HEALTH_TIER_PRIORITY, tier),
          ),
        );
      },
      2_000,
      'Source selection request timed out',
    );
  } catch {
    return {};
  }
}

export async function getSourceSelectionContext(): Promise<SourceSelectionContext> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (!inflight) {
    inflight = Promise.all([getProxyModes(), loadHealthTiers()])
      .then(([proxyModes, healthTiers]) => {
        const value = { proxyModes, healthTiers };
        cached = { value, expiresAt: Date.now() + CONTEXT_TTL_MS };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// 播放中自动换源不能等网络；返回最近一次结果，过期时后台刷新
export function peekSourceSelectionContext(): SourceSelectionContext {
  if (!cached || cached.expiresAt <= Date.now()) {
    void getSourceSelectionContext();
  }
  return cached?.value ?? EMPTY_SOURCE_SELECTION_CONTEXT;
}

export function resetSourceSelectionContextForTests(): void {
  cached = null;
  inflight = null;
}
