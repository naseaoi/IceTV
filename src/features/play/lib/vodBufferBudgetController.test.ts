import { createVodBufferBudgetController } from '@/features/play/lib/vodBufferBudgetController';

const MBPS = 1000 * 1000;
const BUFFER_FULL = 'bufferFullError';

function setup({
  declaredBitrate = 0,
  base = { maxBufferLength: 120, maxMaxBufferLength: 600 },
}: {
  declaredBitrate?: number;
  base?: { maxBufferLength: number; maxMaxBufferLength: number };
} = {}) {
  const hls = {
    config: { ...base },
    levels: [{ bitrate: declaredBitrate }],
  };
  const video = {
    currentTime: 0,
    ranges: [] as Array<[number, number]>,
    get buffered() {
      const ranges = this.ranges;
      return {
        length: ranges.length,
        start: (index: number) => ranges[index][0],
        end: (index: number) => ranges[index][1],
      } as TimeRanges;
    },
  };
  const controller = createVodBufferBudgetController({
    hls,
    video,
    bufferFullErrorDetail: BUFFER_FULL,
  });
  return { hls, video, controller };
}

// 10 秒分片，按给定码率换算字节数
function mainFrag(bitrate: number, level = 0) {
  return {
    type: 'main',
    level,
    duration: 10,
    stats: { loaded: (bitrate * 10) / 8 },
  };
}

describe('createVodBufferBudgetController', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('起播前按清单码率封顶前向上限', () => {
    const { hls, controller } = setup({ declaredBitrate: 10 * MBPS });

    controller.handleFragmentLoading({ type: 'main', level: 0 });

    expect(hls.config).toEqual({ maxBufferLength: 80, maxMaxBufferLength: 80 });
  });

  it('清单码率偏低时以实测分片码率为准', () => {
    const { hls, controller } = setup({ declaredBitrate: 1 * MBPS });

    controller.handleFragmentLoaded(mainFrag(10 * MBPS));

    expect(hls.config.maxMaxBufferLength).toBe(80);
  });

  it('低码率源保持原配置，音轨分片不参与估算', () => {
    const { hls, controller } = setup();

    controller.handleFragmentLoaded(mainFrag(1 * MBPS));
    controller.handleFragmentLoaded({ ...mainFrag(40 * MBPS), type: 'audio' });

    expect(hls.config).toEqual({
      maxBufferLength: 120,
      maxMaxBufferLength: 600,
    });
  });

  it('切到低码率档位后恢复原上限', () => {
    const { hls, controller } = setup();

    controller.handleFragmentLoaded(mainFrag(10 * MBPS, 0));
    expect(hls.config.maxMaxBufferLength).toBe(80);
    controller.handleFragmentLoaded(mainFrag(1 * MBPS, 1));

    expect(hls.config).toEqual({
      maxBufferLength: 120,
      maxMaxBufferLength: 600,
    });
  });

  it('bufferFullError 后把上限压到当前前向缓冲以内，hls.js 不会立刻重下失败分片', () => {
    const { hls, video, controller } = setup();
    controller.handleFragmentLoaded(mainFrag(10 * MBPS));
    // 配额只够约 30 秒：hls.js reduceMaxBufferLength 先于业务监听执行，得 max(30 - 30, 80 / 2, 20) = 40，高于前向 30 秒会立刻重下再撞配额
    video.currentTime = 100;
    video.ranges = [[90, 130]];
    hls.config.maxMaxBufferLength = 40;

    const handled = controller.handleError({
      details: BUFFER_FULL,
      parent: 'main',
      frag: { type: 'main', level: 0, duration: 10 },
    });

    expect(handled).toBe(true);
    expect(hls.config.maxMaxBufferLength).toBe(24);
    expect(hls.config.maxBufferLength).toBe(24);

    controller.handleFragmentLoaded(mainFrag(10 * MBPS));
    controller.handleFragmentLoaded(mainFrag(2 * MBPS, 1));
    expect(hls.config.maxMaxBufferLength).toBe(40);
    controller.handleFragmentLoaded(mainFrag(10 * MBPS));
    expect(hls.config.maxMaxBufferLength).toBe(24);
  });

  it('不把 hls.js 自行降低的上限抬回去', () => {
    const { hls, controller } = setup();
    controller.handleFragmentLoaded(mainFrag(1 * MBPS));
    hls.config.maxMaxBufferLength = 300;

    controller.handleFragmentLoaded(mainFrag(1 * MBPS));

    expect(hls.config.maxMaxBufferLength).toBe(300);
  });

  it('当前位置未缓冲或非主缓冲的 bufferFullError 交给 hls.js 处理', () => {
    const { hls, video, controller } = setup();
    controller.handleFragmentLoaded(mainFrag(10 * MBPS));
    video.currentTime = 100;
    video.ranges = [[200, 260]];

    expect(
      controller.handleError({ details: BUFFER_FULL, parent: 'main' }),
    ).toBe(false);
    video.ranges = [[40, 160]];
    expect(
      controller.handleError({ details: BUFFER_FULL, parent: 'audio' }),
    ).toBe(false);
    expect(
      controller.handleError({ details: 'bufferAppendError', parent: 'main' }),
    ).toBe(false);
    expect(hls.config.maxMaxBufferLength).toBe(80);
  });
});
