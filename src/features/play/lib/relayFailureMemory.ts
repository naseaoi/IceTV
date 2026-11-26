const STORAGE_KEY = 'icetv_relay_failures';
const MAX_ENTRIES = 512;
const MAX_TTL_MS = 10 * 60 * 1000;
const memory = new Map<string, number>();

function keyFor(source: string, url: string): string {
  try {
    const target = new URL(url);
    return `${source}::${target.hostname}:${target.port || (target.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return '';
  }
}

function readMemory(): void {
  try {
    const saved = JSON.parse(
      window.sessionStorage.getItem(STORAGE_KEY) || '{}',
    );
    for (const [key, until] of Object.entries(saved)) {
      if (
        typeof until === 'number' &&
        until > Date.now() &&
        until <= Date.now() + MAX_TTL_MS
      )
        memory.set(key, until);
    }
  } catch {
    /* 会话存储不可用时保留有界内存副本。 */
  }
  for (const [key, until] of memory)
    if (until <= Date.now()) memory.delete(key);
  while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
}

export function isSourceServerUnavailable(
  source: string,
  url?: string,
): boolean {
  if (!source || !url) return false;
  readMemory();
  return (memory.get(keyFor(source, url)) || 0) > Date.now();
}

export function rememberRelayFailure(
  source: string,
  url: string,
  getHeader: (name: string) => string | null,
): boolean {
  const reason = getHeader('X-IceTV-Relay-Failure');
  if (reason !== 'host-forbidden' && reason !== 'host-connection') return false;
  const key = keyFor(source, url);
  if (!source || !key) return false;
  readMemory();
  const seconds = Number(getHeader('Retry-After'));
  memory.set(
    key,
    Date.now() +
      (seconds > 0 ? Math.min(MAX_TTL_MS, seconds * 1000) : MAX_TTL_MS),
  );
  while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value!);
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(memory)),
    );
  } catch {
    /* 内存副本继续生效。 */
  }
  return true;
}
