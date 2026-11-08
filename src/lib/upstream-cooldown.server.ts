import 'server-only';

import { withTimeout } from '@/lib/concurrency';
import { UpstreamCooldownError } from '@/lib/server-resource-errors';
import { resourceKey } from '@/lib/shared-resource-quota.server';
import type { SharedResourceStore } from '@/lib/shared-resource-store';
import {
  UPSTREAM_COOLDOWN_POLICY as policy,
  upstreamCooldownSeconds,
} from '@/lib/upstream-resource-policy';

interface HostCooldown {
  until: number;
  checkedUntil: number;
  reading?: Promise<void>;
}

const localCooldowns = new WeakMap<
  SharedResourceStore,
  Map<string, HostCooldown>
>();

function localCooldown(store: SharedResourceStore, host: string): HostCooldown {
  let hosts = localCooldowns.get(store);
  if (!hosts) {
    hosts = new Map();
    localCooldowns.set(store, hosts);
  }
  let state = hosts.get(host);
  if (state) {
    hosts.delete(host);
  } else {
    if (hosts.size >= policy.maxLocalHosts) {
      const now = Date.now();
      for (const [key, cached] of hosts) {
        if (
          cached.until <= now &&
          cached.checkedUntil <= now &&
          !cached.reading
        )
          hosts.delete(key);
      }
      if (hosts.size >= policy.maxLocalHosts)
        hosts.delete(hosts.keys().next().value!);
    }
    state = { until: 0, checkedUntil: 0 };
  }
  hosts.set(host, state);
  return state;
}

function cooldownError(until: number): UpstreamCooldownError {
  return new UpstreamCooldownError(
    Math.max(1, Math.ceil((until - Date.now()) / 1000)),
  );
}

export async function checkUpstreamCooldown(
  store: SharedResourceStore,
  host: string,
): Promise<void> {
  const state = localCooldown(store, host);
  const now = Date.now();
  if (state.until > now) throw cooldownError(state.until);
  if (state.checkedUntil <= now) {
    if (!state.reading) {
      state.reading = (async () => {
        try {
          const until = await withTimeout(
            store.getCooldown(resourceKey('cooldown:host', host)),
            policy.storeTimeoutMs,
            'Upstream cooldown read timed out',
          );
          // 在途读取不能覆盖同进程刚收到的限流响应。
          state.until = Math.max(state.until, until);
        } catch {
          // 冷却存储故障只降级此附加保护，原有资源额度仍按原策略准入。
        }
        state.checkedUntil = Math.min(
          Date.now() + policy.negativeCacheMs,
          state.until > Date.now() ? state.until : Infinity,
        );
      })().finally(() => {
        state.reading = undefined;
      });
    }
    await state.reading;
  }
  if (state.until > Date.now()) throw cooldownError(state.until);
}

export async function recordUpstreamCooldown(
  store: SharedResourceStore,
  host: string,
  response: Response,
): Promise<UpstreamCooldownError> {
  const state = localCooldown(store, host);
  const now = Date.now();
  const entering = state.until <= now;
  state.until = Math.max(
    state.until,
    now +
      upstreamCooldownSeconds(response.headers.get('retry-after'), now) * 1000,
  );
  state.checkedUntil = 0;
  if (entering)
    console.warn('Upstream host cooldown', {
      host,
      seconds: Math.ceil((state.until - now) / 1000),
      status: response.status,
    });
  try {
    const until = await withTimeout(
      store.extendCooldown(resourceKey('cooldown:host', host), state.until),
      policy.storeTimeoutMs,
      'Upstream cooldown write timed out',
    );
    state.until = Math.max(state.until, until);
  } catch {
    // 本地冷却先于写库生效，写失败或超时仍可保护本实例。
  }
  return cooldownError(state.until);
}
