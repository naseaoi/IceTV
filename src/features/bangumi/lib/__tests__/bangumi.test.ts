import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers';

const proxyEnvKeys = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const;

const calendarPayload = [
  {
    weekday: { en: 'Sun' },
    items: [
      {
        id: 1,
        name: 'Anime',
        name_cn: '动画',
        rating: { score: 8.1 },
        air_date: '2026-01-01',
        images: {
          large: 'https://lain.bgm.tv/pic/cover/l/00/00/1.jpg',
          common: '',
          medium: '',
          small: '',
          grid: '',
        },
      },
    ],
  },
];

function calendarPayloadWithId(id: number) {
  return [
    {
      ...calendarPayload[0],
      items: [{ ...calendarPayload[0].items[0], id }],
    },
  ];
}

function flushBackground() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

type MockRequest = EventEmitter & {
  destroy: jest.Mock;
  end: jest.Mock;
  setTimeout: jest.Mock;
};

type MockResponse = EventEmitter & {
  resume: jest.Mock;
  statusCode: number;
};

let savedProxyEnv: Record<(typeof proxyEnvKeys)[number], string | undefined>;

function mockHttpsRequest(payloads: unknown[]) {
  const responseQueue = [...payloads];
  const requestMock = jest.fn(
    (
      _url: URL,
      _options: unknown,
      callback: (response: MockResponse) => void,
    ) => {
      const request = new EventEmitter() as MockRequest;

      request.setTimeout = jest.fn();
      request.destroy = jest.fn((error?: Error) => {
        if (error) {
          request.emit('error', error);
        }
        request.emit('close');
      });
      request.end = jest.fn(() => {
        const response = new EventEmitter() as MockResponse;
        const payload = responseQueue.shift();

        if (payload instanceof Error) {
          request.emit('error', payload);
          return;
        }

        response.statusCode = 200;
        response.resume = jest.fn();
        callback(response);

        queueMicrotask(() => {
          response.emit('data', Buffer.from(JSON.stringify(payload)));
          response.emit('end');
          request.emit('close');
        });
      });

      return request;
    },
  );

  jest.doMock('node:http', () => ({ request: jest.fn() }));
  jest.doMock('node:https', () => ({ request: requestMock }));

  return requestMock;
}

async function loadBangumiModule() {
  return require('../bangumi') as typeof import('../bangumi');
}

beforeEach(() => {
  jest.resetModules();
  savedProxyEnv = Object.fromEntries(
    proxyEnvKeys.map((key) => [key, process.env[key]]),
  ) as Record<(typeof proxyEnvKeys)[number], string | undefined>;

  proxyEnvKeys.forEach((key) => {
    delete process.env[key];
  });
});

afterEach(() => {
  proxyEnvKeys.forEach((key) => {
    const value = savedProxyEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
  jest.dontMock('node:http');
  jest.dontMock('node:https');
  jest.restoreAllMocks();
});

describe('getBangumiCalendarData', () => {
  it('fetches Bangumi calendar data from the official endpoint', async () => {
    const requestMock = mockHttpsRequest([calendarPayload]);
    const { getBangumiCalendarData } = await loadBangumiModule();
    const data = await getBangumiCalendarData();

    expect(data[0].items[0].id).toBe(1);
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0].toString()).toBe(
      'https://api.bgm.tv/calendar',
    );
  });

  it('retries failed Bangumi calendar requests without a short timeout', async () => {
    const requestMock = mockHttpsRequest([
      new Error('network failed'),
      calendarPayload,
    ]);
    const { getBangumiCalendarData } = await loadBangumiModule();
    const data = await getBangumiCalendarData();

    expect(data[0].items[0].id).toBe(1);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('caches usable Bangumi calendar data', async () => {
    const requestMock = mockHttpsRequest([calendarPayload]);
    const { getBangumiCalendarData } = await loadBangumiModule();

    await getBangumiCalendarData();
    await getBangumiCalendarData();

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('shares one upstream request between concurrent callers', async () => {
    const requestMock = mockHttpsRequest([calendarPayload]);
    const { getBangumiCalendarData } = await loadBangumiModule();

    const [first, second] = await Promise.all([
      getBangumiCalendarData(),
      getBangumiCalendarData(),
    ]);

    expect(first).toBe(second);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('serves stale data immediately and refreshes it in the background', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const requestMock = mockHttpsRequest([
      calendarPayload,
      calendarPayloadWithId(2),
    ]);
    const { getBangumiCalendarData } = await loadBangumiModule();

    await getBangumiCalendarData();

    nowSpy.mockReturnValue(1000 + 6 * 60 * 60 * 1000 + 1);
    const stale = await getBangumiCalendarData();
    expect(stale[0].items[0].id).toBe(1);
    expect(requestMock).toHaveBeenCalledTimes(2);

    await flushBackground();
    const refreshed = await getBangumiCalendarData();
    expect(refreshed[0].items[0].id).toBe(2);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('keeps stale data when the background refresh fails', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const requestMock = mockHttpsRequest([
      calendarPayload,
      new Error('network failed'),
      new Error('network failed'),
    ]);
    const { getBangumiCalendarData } = await loadBangumiModule();

    await getBangumiCalendarData();

    nowSpy.mockReturnValue(1000 + 6 * 60 * 60 * 1000 + 1);
    await getBangumiCalendarData({ timeoutMs: 1000 });
    await flushBackground();
    const data = await getBangumiCalendarData({ timeoutMs: 1000 });
    await flushBackground();

    expect(data[0].items[0].id).toBe(1);
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('drops data past the maximum age and reloads it', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const requestMock = mockHttpsRequest([
      calendarPayload,
      new Error('network failed'),
    ]);
    const { getBangumiCalendarData } = await loadBangumiModule();

    await getBangumiCalendarData();

    nowSpy.mockReturnValue(1000 + 24 * 60 * 60 * 1000 + 1);
    await expect(getBangumiCalendarData({ timeoutMs: 1000 })).rejects.toThrow(
      'network failed',
    );
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache calendars without any items', async () => {
    const emptyPayload = [{ weekday: { en: 'Sun' }, items: [] }];
    const requestMock = mockHttpsRequest([
      emptyPayload,
      emptyPayload,
      calendarPayload,
    ]);
    const { getBangumiCalendarData } = await loadBangumiModule();

    const empty = await getBangumiCalendarData();
    const data = await getBangumiCalendarData();

    expect(empty[0].items).toHaveLength(0);
    expect(data[0].items[0].id).toBe(1);
    expect(requestMock).toHaveBeenCalledTimes(3);
  });
});
