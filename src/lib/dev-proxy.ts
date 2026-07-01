const DEV_PROXY_ENV_KEYS = ['DEV_HTTP_PROXY', 'HTTPS_PROXY', 'HTTP_PROXY'];
const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1';

function resolveDevProxyUrl(): string | null {
  for (const key of DEV_PROXY_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

export function isDevProxyActive(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEV_PROXY_ENABLED === 'true' &&
    resolveDevProxyUrl() !== null
  );
}

export async function setupDevProxy(): Promise<void> {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.DEV_PROXY_ENABLED !== 'true'
  ) {
    return;
  }

  const proxyUrl = resolveDevProxyUrl();
  if (!proxyUrl) {
    console.warn('[dev-proxy] DEV_PROXY_ENABLED=true 但未找到代理地址,已跳过');
    return;
  }

  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici');
  const noProxy = process.env.NO_PROXY?.trim() || DEFAULT_NO_PROXY;
  setGlobalDispatcher(
    new EnvHttpProxyAgent({
      httpProxy: proxyUrl,
      httpsProxy: proxyUrl,
      noProxy,
    }),
  );
  console.log(
    `[dev-proxy] 出站请求已走代理: ${proxyUrl} (NO_PROXY=${noProxy})`,
  );
}
