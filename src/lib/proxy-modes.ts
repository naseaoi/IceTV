let cachedModes: Record<string, string> | null = null;
let cacheExpiry = 0;
let inflightPromise: Promise<Record<string, string>> | null = null;

const CACHE_TTL_MS = 30_000;
const OVERRIDE_STORAGE_KEY = 'icetv_proxy_mode_overrides';
const OVERRIDE_TTL_MS = 30 * 60 * 1000;

export type SourceProxyMode = 'browser' | 'server' | 'auto';

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

function getRouteOverrideKey(sourceKey: string, rawUrl?: string): string {
  if (!rawUrl) return sourceKey;
  try {
    const url = new URL(rawUrl);
    return `${sourceKey}::${url.origin}${url.pathname}`;
  } catch {
    return `${sourceKey}::${rawUrl}`;
  }
}

function getConfiguredProxyMode(
  sourceKey: string,
  modes?: Record<string, string> | null,
): SourceProxyMode {
  const resolvedModes = modes || cachedModes || {};
  const mode = resolvedModes[sourceKey];
  return mode === 'server' || mode === 'auto' ? mode : 'browser';
}

function getRuntimeProxyOverride(
  sourceKey: string,
  rawUrl?: string,
): 'server' | undefined {
  if (!sourceKey) return undefined;
  const data = readOverrides();
  const overrideKey = getRouteOverrideKey(sourceKey, rawUrl);
  if (rawUrl && data[sourceKey]) {
    delete data[sourceKey];
    writeOverrides(data);
  }
  const entry = data[overrideKey];
  if (!entry) return undefined;
  if (Date.now() - entry.at > OVERRIDE_TTL_MS) {
    delete data[overrideKey];
    delete data[sourceKey];
    writeOverrides(data);
    return undefined;
  }
  return entry.mode;
}

function dropLegacySourceOverride(sourceKey: string, rawUrl?: string): void {
  if (!sourceKey || !rawUrl) return;
  const data = readOverrides();
  if (!data[sourceKey]) return;
  delete data[sourceKey];
  writeOverrides(data);
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
  rawUrl?: string,
  modes?: Record<string, string>,
): boolean {
  dropLegacySourceOverride(sourceKey, rawUrl);
  const configuredMode = getConfiguredProxyMode(sourceKey, modes);
  if (configuredMode === 'server') {
    return true;
  }
  if (configuredMode === 'browser') {
    return false;
  }
  if (getRuntimeProxyOverride(sourceKey, rawUrl) === 'server') {
    return true;
  }
  return false;
}

export function isServerProxy(sourceKey: string, rawUrl?: string): boolean {
  return shouldUseServerProxy(sourceKey, rawUrl);
}

export function shouldAutoFallbackToServer(sourceKey: string): boolean {
  return getConfiguredProxyMode(sourceKey) === 'auto';
}

export function rememberSourceServerProxy(
  sourceKey: string,
  rawUrl?: string,
): void {
  if (!sourceKey) return;
  if (getConfiguredProxyMode(sourceKey) !== 'auto') return;
  const data = readOverrides();
  data[getRouteOverrideKey(sourceKey, rawUrl)] = {
    mode: 'server',
    at: Date.now(),
  };
  writeOverrides(data);
}

export function clearSourceProxyOverride(
  sourceKey: string,
  rawUrl?: string,
): void {
  if (!sourceKey) return;
  const data = readOverrides();
  if (rawUrl) {
    const overrideKey = getRouteOverrideKey(sourceKey, rawUrl);
    if (data[overrideKey]) {
      delete data[overrideKey];
      writeOverrides(data);
    }
    return;
  }

  let changed = false;
  Object.keys(data).forEach((key) => {
    if (key === sourceKey || key.startsWith(`${sourceKey}::`)) {
      delete data[key];
      changed = true;
    }
  });
  if (changed) {
    writeOverrides(data);
  }
}

export function preloadProxyModes(): void {
  getProxyModes().catch(() => {});
}
