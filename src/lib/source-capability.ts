type Capability = {
  cors: boolean;
  at: number;
};

const capabilityMap = new Map<string, Capability>();
const CAPABILITY_TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;

export function responseAllowsCors(
  headers: Headers,
  requestOrigin?: string | null,
): boolean {
  const allowOrigin = headers.get('access-control-allow-origin');
  if (!allowOrigin) return false;
  if (allowOrigin === '*') return true;
  if (requestOrigin && allowOrigin === requestOrigin) return true;
  return false;
}

export function markSourceCors(sourceKey: string, capable: boolean): void {
  if (!sourceKey) return;
  if (capabilityMap.size >= MAX_ENTRIES && !capabilityMap.has(sourceKey)) {
    const firstKey = capabilityMap.keys().next().value;
    if (firstKey) capabilityMap.delete(firstKey);
  }
  capabilityMap.set(sourceKey, { cors: capable, at: Date.now() });
}

export function isSourceCorsCapable(sourceKey: string): boolean | undefined {
  if (!sourceKey) return undefined;
  const entry = capabilityMap.get(sourceKey);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CAPABILITY_TTL_MS) {
    capabilityMap.delete(sourceKey);
    return undefined;
  }
  return entry.cors;
}
