let cachedModes: Record<string, string> | null = null;
let cacheExpiry = 0;
let inflightPromise: Promise<Record<string, string>> | null = null;

const CACHE_TTL_MS = 30_000;
const OVERRIDE_STORAGE_KEY = 'icetv_proxy_mode_overrides';
const OVERRIDE_TTL_MS = 30 * 60 * 1000;

type ProxyOverrideMap = Record<string, { mode: 'server'; at: number }>;

function isStorageAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage;
}

function readOverrides(): ProxyOverrideMap {
  if (!isStorageAvailable()) return {};
  try {
    const raw = window.sessionStorage.getItem(OVERRIDE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverrides(data: ProxyOverrideMap): void {
  if (!isStorageAvailable()) return;
  try {
    const now = Date.now();
    for (const key of Object.keys(data)) {
      const entry = data[key];
      if (!entry || now - entry.at > OVERRIDE_TTL_MS) {
        delete data[key];
      }
    }
    window.sessionStorage.setItem(OVERRIDE_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function getRuntimeProxyOverride(sourceKey: string): 'server' | undefined {
  if (!sourceKey) return undefined;
  const data = readOverrides();
  const entry = data[sourceKey];
  if (!entry) return undefined;
  if (Date.now() - entry.at > OVERRIDE_TTL_MS) {
    delete data[sourceKey];
    writeOverrides(data);
    return undefined;
  }
  return entry.mode;
}

async function fetchProxyModes(): Promise<Record<string, string>> {
  try {
    const res = await fetch('/api/proxy-modes');
    if (res.ok) {
      const data = (await res.json()) as Record<string, string>;
      cachedModes = data;
      cacheExpiry = Date.now() + CACHE_TTL_MS;
      return data;
    }
  } catch {}
  return cachedModes || {};
}

export async function getProxyModes(): Promise<Record<string, string>> {
  if (cachedModes && Date.now() < cacheExpiry) {
    return cachedModes;
  }
  if (!inflightPromise) {
    inflightPromise = fetchProxyModes().finally(() => {
      inflightPromise = null;
    });
  }
  return inflightPromise;
}

export function shouldUseServerProxy(
  sourceKey: string,
  modes?: Record<string, string>,
): boolean {
  if (getRuntimeProxyOverride(sourceKey) === 'server') {
    return true;
  }
  const resolvedModes = modes || cachedModes || {};
  return resolvedModes[sourceKey] === 'server';
}

export function isServerProxy(sourceKey: string): boolean {
  return shouldUseServerProxy(sourceKey);
}

export function rememberSourceServerProxy(sourceKey: string): void {
  if (!sourceKey) return;
  const data = readOverrides();
  data[sourceKey] = {
    mode: 'server',
    at: Date.now(),
  };
  writeOverrides(data);
}

export function clearSourceProxyOverride(sourceKey: string): void {
  if (!sourceKey) return;
  const data = readOverrides();
  if (data[sourceKey]) {
    delete data[sourceKey];
    writeOverrides(data);
  }
}

export function preloadProxyModes(): void {
  getProxyModes().catch(() => {});
}
