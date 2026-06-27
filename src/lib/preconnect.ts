const injected = new Set<string>();

function injectPreconnect(origin: string, crossOrigin = true): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (!origin || injected.has(origin)) return () => undefined;

  try {
    const u = new URL(origin);
    const normalized = `${u.protocol}//${u.host}`;
    if (injected.has(normalized)) return () => undefined;

    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = normalized;
    if (crossOrigin) link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
    injected.add(normalized);

    return () => {
      link.remove();
      injected.delete(normalized);
    };
  } catch {
    return () => undefined;
  }
}

export function preconnectForUrl(url: string, crossOrigin = true): void {
  if (!url) return;
  try {
    const u = new URL(url);
    injectPreconnect(`${u.protocol}//${u.host}`, crossOrigin);
  } catch {}
}
