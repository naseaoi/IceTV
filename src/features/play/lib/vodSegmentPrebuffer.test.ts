import { createVodSegmentPrebufferController } from '@/features/play/lib/vodSegmentPrebuffer';

function createFragments(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    duration: 4,
    end: (index + 1) * 4,
    start: index * 4,
    url: `https://xgct-video.bzcdn.net/video${index}.ts`,
  }));
}

describe('VOD segment prebuffer', () => {
  it('prefetches a bounded xigua 720p window after the playback head', async () => {
    const requestedUrls: string[] = [];
    const fetcher = jest.fn(async (url: string) => {
      requestedUrls.push(url);
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1),
      };
    });
    const controller = createVodSegmentPrebufferController({
      fetcher,
      getCurrentTime: () => 40,
      isServerProxy: () => false,
      sourceKey: 'xigua',
    });

    expect(
      controller.handleLevelLoaded({
        fragments: createFragments(50),
        levelHeight: 720,
      }),
    ).toBe(true);
    const result = await controller.waitForIdle();

    expect(result).toEqual({ attempted: 18, succeeded: 18 });
    expect(requestedUrls[0]).toContain('video13.ts');
    expect(requestedUrls.at(-1)).toContain('video30.ts');
  });

  it('rolls the prebuffer window forward without duplicate requests', async () => {
    let currentTime = 0;
    const requestedUrls: string[] = [];
    const fetcher = jest.fn(async (url: string) => {
      requestedUrls.push(url);
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1),
      };
    });
    const controller = createVodSegmentPrebufferController({
      fetcher,
      getCurrentTime: () => currentTime,
      isServerProxy: () => false,
      sourceKey: 'xigua',
    });

    controller.handleLevelLoaded({
      fragments: createFragments(50),
      levelHeight: 720,
    });
    await controller.waitForIdle();
    currentTime = 40;

    expect(controller.handlePlaybackProgress()).toBe(true);
    const result = await controller.waitForIdle();

    expect(result).toEqual({ attempted: 28, succeeded: 28 });
    expect(new Set(requestedUrls).size).toBe(requestedUrls.length);
    expect(requestedUrls).toContain('https://xgct-video.bzcdn.net/video30.ts');
    expect(requestedUrls.at(-1)).toContain('video30.ts');
  });

  it('ignores unsupported levels, routes, sources, and segment hosts', async () => {
    const fetcher = jest.fn();
    const baseOptions = {
      fetcher,
      getCurrentTime: () => 0,
      isServerProxy: () => false,
      sourceKey: 'xigua',
    };
    const fragments = createFragments(10);

    expect(
      createVodSegmentPrebufferController(baseOptions).handleLevelLoaded({
        fragments,
        levelHeight: 480,
      }),
    ).toBe(false);
    expect(
      createVodSegmentPrebufferController({
        ...baseOptions,
        isServerProxy: () => true,
      }).handleLevelLoaded({ fragments, levelHeight: 720 }),
    ).toBe(false);
    expect(
      createVodSegmentPrebufferController({
        ...baseOptions,
        sourceKey: 'other',
      }).handleLevelLoaded({ fragments, levelHeight: 720 }),
    ).toBe(false);
    expect(
      createVodSegmentPrebufferController(baseOptions).handleLevelLoaded({
        fragments: fragments.map((fragment) => ({
          ...fragment,
          url: fragment.url.replace(
            'xgct-video.bzcdn.net',
            'untrusted.example.com',
          ),
        })),
        levelHeight: 720,
      }),
    ).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('tolerates individual prefetch failures', async () => {
    let requestCount = 0;
    const fetcher = jest.fn(async () => {
      requestCount += 1;
      if (requestCount === 2) {
        throw new Error('network failure');
      }
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1),
      };
    });
    const controller = createVodSegmentPrebufferController({
      fetcher,
      getCurrentTime: () => 0,
      isServerProxy: () => false,
      sourceKey: 'xigua',
    });
    controller.handleLevelLoaded({
      fragments: createFragments(10),
      levelHeight: 720,
    });

    await expect(controller.waitForIdle()).resolves.toEqual({
      attempted: 7,
      succeeded: 6,
    });
  });

  it('aborts active prefetches when disposed', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetcher = jest.fn(
      async (_url: string, init: RequestInit) =>
        new Promise<{
          ok: boolean;
          arrayBuffer: () => Promise<ArrayBuffer>;
        }>((_resolve, reject) => {
          capturedSignal = init.signal as AbortSignal;
          capturedSignal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const controller = createVodSegmentPrebufferController({
      fetcher,
      getCurrentTime: () => 0,
      isServerProxy: () => false,
      sourceKey: 'xigua',
    });
    controller.handleLevelLoaded({
      fragments: createFragments(10),
      levelHeight: 720,
    });

    await Promise.resolve();
    controller.dispose();

    expect(capturedSignal?.aborted).toBe(true);
    await expect(controller.waitForIdle()).resolves.toEqual({
      attempted: 7,
      succeeded: 0,
    });
  });
});
