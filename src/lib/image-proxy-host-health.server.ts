import 'server-only';

// 连续失败达到阈值后冷却，期间直接判失败，让前端尽快回退直连而不是逐张等回源超时
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000;
const MAX_HOSTS = 500;

type HostHealth = { failures: number; cooldownUntil: number };

// 进程内状态，多实例时各自探测。只作用于图片代理，不影响同域名的搜索、详情回源
const hosts = new Map<string, HostHealth>();

export function isImageHostCoolingDown(
  hostname: string,
  now = Date.now(),
): boolean {
  const health = hosts.get(hostname);
  return Boolean(health && health.cooldownUntil > now);
}

export function recordImageHostFailure(
  hostname: string,
  now = Date.now(),
): void {
  const failures = (hosts.get(hostname)?.failures ?? 0) + 1;
  hosts.delete(hostname);
  hosts.set(hostname, {
    failures,
    // 冷却结束后的首次探测仍失败时立即重新冷却
    cooldownUntil: failures >= FAILURE_THRESHOLD ? now + COOLDOWN_MS : 0,
  });
  if (hosts.size > MAX_HOSTS) {
    hosts.delete(hosts.keys().next().value as string);
  }
}

export function recordImageHostReachable(hostname: string): void {
  hosts.delete(hostname);
}

// 只把能说明整个站点不可用的结果算作域名失败；404 等单图问题说明站点仍在正常响应。
// 429 与带 Retry-After 的 503 已由回源层的共享冷却处理，不会走到这里
export function isHostLevelImageStatus(status: number): boolean {
  return status === 403 || status >= 500;
}

export function clearImageHostHealthForTests(): void {
  hosts.clear();
}
