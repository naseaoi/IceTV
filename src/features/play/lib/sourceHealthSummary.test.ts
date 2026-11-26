import {
  loadSourceHealthSummary,
  resetSourceHealthSummaryForTests,
} from '@/features/play/lib/sourceHealthSummary';

const daily = [
  { date: '2026-11-25', status: 'ok' },
  { date: '2026-11-26', status: 'degraded' },
];

function mockResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe('sourceHealthSummary', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    resetSourceHealthSummaryForTests();
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('只保留结构有效的条目', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({
        days: 7,
        items: {
          good: {
            tier: 'good',
            playAvailability: 0.96,
            searchAvailability: 0.99,
            lastOkDate: '2026-11-26',
            daily,
          },
          badTier: { ...{ tier: 'insufficient' }, daily },
          badRate: {
            tier: 'poor',
            playAvailability: 2,
            searchAvailability: null,
            lastOkDate: null,
            daily,
          },
          badDaily: {
            tier: 'poor',
            playAvailability: null,
            searchAvailability: null,
            lastOkDate: null,
            daily: [{ date: '2026-11-26', status: 'unknown' }],
          },
        },
      }),
    );

    const summary = await loadSourceHealthSummary();

    expect(Object.keys(summary)).toEqual(['good']);
    expect(summary.good).toMatchObject({ tier: 'good', daily });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/source-health',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('成功结果在有效期内复用，失败结果不缓存', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ error: 'x' }, false));
    expect(await loadSourceHealthSummary()).toEqual({});

    fetchMock.mockResolvedValueOnce(
      mockResponse({
        days: 7,
        items: {
          a: {
            tier: 'offline',
            playAvailability: null,
            searchAvailability: 0,
            lastOkDate: null,
            daily,
          },
        },
      }),
    );
    expect(Object.keys(await loadSourceHealthSummary())).toEqual(['a']);
    expect(Object.keys(await loadSourceHealthSummary())).toEqual(['a']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
