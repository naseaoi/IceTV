import type { NextRequest } from 'next/server';

import { getRewrittenM3U8Content } from './m3u8-rewrite';

jest.mock('@/lib/proxy-auth', () => ({
  appendProxySignature: jest.fn(async (params: URLSearchParams) => {
    params.set('signature', 'test-signature');
  }),
}));

jest.mock('@/lib/source-capability', () => ({
  isSourceCorsCapable: jest.fn(() => false),
}));

function createRequest(search = ''): NextRequest {
  return {
    url: `http://localhost/api/proxy/m3u8${search}`,
    headers: new Headers({
      host: 'localhost',
      referer: 'http://localhost/live',
    }),
  } as NextRequest;
}

const mediaPlaylist = [
  '#EXTM3U',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
  '#EXTINF:6,',
  'segment-1.ts',
].join('\n');

describe('m3u8 rewrite', () => {
  it('keeps live media resources direct when browser direct mode is enabled', async () => {
    const result = await getRewrittenM3U8Content(
      {
        content: mediaPlaylist,
        finalUrl: 'https://stream.example.com/live/index.m3u8',
        loadedAt: 1,
      },
      'https://stream.example.com/live/index.m3u8',
      createRequest('?allowCORS=true&icetv-live=1'),
      true,
      false,
      'live-source',
      true,
      false,
    );

    expect(result).toContain(
      '#EXT-X-MAP:URI="https://stream.example.com/live/init.mp4"',
    );
    expect(result).toContain(
      '#EXT-X-KEY:METHOD=AES-128,URI="https://stream.example.com/live/key.bin"',
    );
    expect(result).toContain('https://stream.example.com/live/segment-1.ts');
    expect(result).not.toContain('/api/proxy/segment');
    expect(result).not.toContain('/api/proxy/key');
  });

  it('keeps live media resources behind the server proxy by default', async () => {
    const result = await getRewrittenM3U8Content(
      {
        content: mediaPlaylist,
        finalUrl: 'https://stream.example.com/live/index.m3u8',
        loadedAt: 2,
      },
      'https://stream.example.com/live/index.m3u8',
      createRequest('?icetv-live=1'),
      false,
      false,
      'live-source',
      true,
      false,
    );

    expect(result).toContain('/api/proxy/segment?');
    expect(result).toContain('/api/proxy/key?');
    expect(result).toContain('icetv-live=1');
    expect(result).toContain('signature=test-signature');
  });

  it('passes browser direct mode to nested live playlists', async () => {
    const result = await getRewrittenM3U8Content(
      {
        content: [
          '#EXTM3U',
          '#EXT-X-STREAM-INF:BANDWIDTH=8000000',
          'high/index.m3u8',
        ].join('\n'),
        finalUrl: 'https://stream.example.com/live/master.m3u8',
        loadedAt: 3,
      },
      'https://stream.example.com/live/master.m3u8',
      createRequest('?allowCORS=true&icetv-live=1'),
      true,
      false,
      'live-source',
      true,
      false,
    );

    const nestedUrl = result
      .split('\n')
      .find((line) => line.includes('/api/proxy/m3u8?'));
    expect(nestedUrl).toBeDefined();
    expect(new URL(nestedUrl!).searchParams.get('allowCORS')).toBe('true');
    expect(new URL(nestedUrl!).searchParams.get('icetv-live')).toBe('1');
  });

  it('lets force server mode override browser direct mode', async () => {
    const result = await getRewrittenM3U8Content(
      {
        content: mediaPlaylist,
        finalUrl: 'https://stream.example.com/live/index.m3u8',
        loadedAt: 4,
      },
      'https://stream.example.com/live/index.m3u8',
      createRequest('?allowCORS=true&forceServer=true&icetv-live=1'),
      true,
      true,
      'live-source',
      true,
      false,
    );

    expect(result).toContain('/api/proxy/segment?');
    expect(result).toContain('/api/proxy/key?');
  });
});
