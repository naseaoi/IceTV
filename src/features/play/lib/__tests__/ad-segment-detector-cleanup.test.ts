/** @jest-environment node */

import { stripAdSegmentsByPhysicalSignal } from '@/features/play/lib/ad-segment-detector';

const mockFetch = jest.fn();
jest.mock('@/lib/url-guard', () => ({
  fetchWithUrlGuard: (...args: unknown[]) => mockFetch(...args),
}));

it.each([200, 206, 503])(
  'Range 探测状态 %s 仅读头后取消正文',
  async (status) => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    const arrayBuffer = jest.fn();
    mockFetch.mockResolvedValue({
      ok: status < 300,
      status,
      headers: { get: () => 'bytes 0-187/1000000' },
      body: { cancel },
      arrayBuffer,
    });
    const playlist = [
      '#EXTM3U',
      ...[12.345, 12.345, 12.345, 22.345].flatMap((duration, i) => [
        '#EXT-X-DISCONTINUITY',
        `#EXTINF:${duration},`,
        `${i}.ts`,
      ]),
      '#EXT-X-ENDLIST',
    ].join('\n');
    await stripAdSegmentsByPhysicalSignal(
      playlist,
      'https://example.com/index.m3u8',
      'test',
    );
    expect(cancel).toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
  },
);
