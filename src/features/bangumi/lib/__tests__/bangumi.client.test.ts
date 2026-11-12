import { GetBangumiCalendarDataWithMeta } from '../bangumi.client';

const calendar = [
  {
    weekday: { en: 'Sun' },
    items: [
      {
        id: 1,
        name: 'Anime',
        name_cn: '动画',
        rating: { score: 8 },
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

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 502,
    json: async () => body,
  } as Response;
}

describe('GetBangumiCalendarDataWithMeta', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function requestedUrls() {
    return fetchMock.mock.calls.map(([url]) => String(url));
  }

  it('uses the server cache first', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(calendar));

    const result = await GetBangumiCalendarDataWithMeta();

    expect(result.data[0].items[0].id).toBe(1);
    expect(requestedUrls()).toEqual(['/api/bangumi/calendar']);
  });

  it.each([
    ['fails', () => Promise.resolve(jsonResponse({ error: 'x' }, false))],
    ['is unreachable', () => Promise.reject(new TypeError('network'))],
    [
      'has no items',
      () =>
        Promise.resolve(jsonResponse([{ weekday: { en: 'Sun' }, items: [] }])),
    ],
  ])('falls back to the browser when the server %s', async (_, server) => {
    fetchMock
      .mockImplementationOnce(server)
      .mockResolvedValueOnce(jsonResponse(calendar));

    const result = await GetBangumiCalendarDataWithMeta();

    expect(result.data[0].items[0].id).toBe(1);
    expect(requestedUrls()).toEqual([
      '/api/bangumi/calendar',
      'https://api.bgm.tv/calendar',
    ]);
  });

  it('serves the local cache without requesting again', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(calendar));
    await GetBangumiCalendarDataWithMeta();

    const result = await GetBangumiCalendarDataWithMeta();

    expect(result.data[0].items[0].id).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
