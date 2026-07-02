import { getConfigForRead } from '@/lib/config';

const DEFAULT_LIVE_UA = 'AptvPlayer/1.4.10';
const DEFAULT_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function getProxySourceKey(searchParams: URLSearchParams) {
  return (
    searchParams.get('icetv-source') ||
    searchParams.get('moontv-source') ||
    searchParams.get('source')
  );
}

export async function resolveProxyUserAgent(source: string | null) {
  const config = await getConfigForRead();
  const liveSource = source
    ? config.LiveConfig?.find((s: any) => s.key === source)
    : null;
  if (liveSource) {
    return liveSource.ua || DEFAULT_LIVE_UA;
  }
  return DEFAULT_BROWSER_UA;
}
