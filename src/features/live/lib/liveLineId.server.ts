import { createHash } from 'node:crypto';

export const DEFAULT_LIVE_USER_AGENT = 'AptvPlayer/1.4.10';

export function getLiveUserAgent(ua?: string): string {
  return ua?.trim() || DEFAULT_LIVE_USER_AGENT;
}

export function createLiveLineId(
  source: { key: string; url: string; ua?: string },
  channelUrl: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        source.key,
        source.url.trim(),
        getLiveUserAgent(source.ua),
        channelUrl,
      ]),
    )
    .digest('hex')
    .slice(0, 20);
}
