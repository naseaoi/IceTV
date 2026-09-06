export interface SyntheticHostMetrics {
  requests: number;
  active: number;
  peakConnections: number;
  failures: number;
  bytes: number;
}

export function createSyntheticUpstream() {
  const hosts = new Map<string, SyntheticHostMetrics>();

  async function fetch(url: string, signal?: AbortSignal): Promise<Response> {
    const target = new URL(url);
    const metrics = hosts.get(target.hostname) ?? {
      requests: 0,
      active: 0,
      peakConnections: 0,
      failures: 0,
      bytes: 0,
    };
    hosts.set(target.hostname, metrics);
    metrics.requests += 1;
    metrics.active += 1;
    metrics.peakConnections = Math.max(metrics.peakConnections, metrics.active);
    let finished = false;
    const finish = (failed = false) => {
      if (finished) return;
      finished = true;
      metrics.active -= 1;
      if (failed) metrics.failures += 1;
    };
    await new Promise((resolve) => setTimeout(resolve, 8));
    if (signal?.aborted) {
      finish(true);
      throw signal.reason;
    }
    let payload: Uint8Array;
    let contentType = 'application/json';
    if (target.pathname.endsWith('.m3u8')) {
      contentType = 'application/vnd.apple.mpegurl';
      payload = Buffer.from(
        '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n',
      );
    } else if (
      target.pathname.endsWith('.ts') ||
      target.pathname.endsWith('.webp')
    ) {
      contentType = target.pathname.endsWith('.ts')
        ? 'video/mp2t'
        : 'image/webp';
      payload = new Uint8Array(
        target.pathname.endsWith('.ts') ? 256 * 1024 : 32 * 1024,
      );
    } else if (target.hostname.includes('douban')) {
      payload = Buffer.from(
        JSON.stringify({
          items: Array.from({ length: 20 }, (_, index) => ({
            id: String(index),
            title: 'Synthetic title',
            card_subtitle: '2026',
            pic: { normal: 'https://cover.example/cover.webp' },
            rating: { value: 8 },
          })),
        }),
      );
    } else {
      payload = Buffer.from(
        JSON.stringify({
          pagecount: 1,
          list: [
            {
              vod_id: 1,
              vod_name: 'Synthetic title',
              vod_pic: 'https://cover.example/cover.webp',
              vod_year: '2026',
              vod_play_url: 'Main$https://media.example/playlist.m3u8',
            },
          ],
        }),
      );
    }
    let offset = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            if (signal?.aborted) {
              finish(true);
              controller.error(signal.reason);
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1));
            const chunk = payload.subarray(offset, offset + 16 * 1024);
            offset += chunk.byteLength;
            metrics.bytes += chunk.byteLength;
            controller.enqueue(chunk);
            if (offset >= payload.byteLength) {
              finish();
              controller.close();
            }
          },
          cancel() {
            finish(true);
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'Content-Type': contentType } },
    );
    Object.defineProperty(response, 'url', { value: url });
    return response;
  }

  return { fetch, hosts };
}
