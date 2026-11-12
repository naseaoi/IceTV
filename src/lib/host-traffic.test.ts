import {
  computeHostTrafficStatus,
  normalizeTrafficSettings,
  parseVnstatDaily,
  resolveTrafficCycle,
  TRAFFIC_GB,
  TRAFFIC_STALE_MS,
} from '@/lib/host-traffic';

const GB = TRAFFIC_GB;

function vnstatDay(date: string, rx: number, tx: number) {
  const [year, month, day] = date.split('-').map(Number);
  return { id: 0, date: { year, month, day }, rx, tx };
}

function snapshot(days: [string, number, number][], updatedAt: number) {
  return {
    days: days.map(([date, rx, tx]) => ({ date, rx, tx })),
    updatedAt,
  };
}

describe('parseVnstatDaily', () => {
  it('sums every interface by day and keeps the latest update time', () => {
    const parsed = parseVnstatDaily({
      jsonversion: '2',
      interfaces: [
        {
          name: 'eth0',
          updated: { timestamp: 1_000 },
          traffic: {
            day: [vnstatDay('2026-11-02', 5, 6), vnstatDay('2026-11-01', 1, 2)],
          },
        },
        {
          name: 'eth1',
          updated: { timestamp: 2_000 },
          traffic: { day: [vnstatDay('2026-11-01', 10, 20)] },
        },
      ],
    });
    expect(parsed).toEqual({
      days: [
        { date: '2026-11-01', rx: 11, tx: 22 },
        { date: '2026-11-02', rx: 5, tx: 6 },
      ],
      updatedAt: 2_000_000,
    });
  });

  it('rejects files without usable interfaces and skips malformed days', () => {
    expect(parseVnstatDaily(null)).toBeNull();
    expect(parseVnstatDaily({ interfaces: [] })).toBeNull();
    expect(
      parseVnstatDaily({
        interfaces: [
          {
            traffic: {
              day: [
                { date: { year: 2026, month: 11, day: 1 }, rx: -1, tx: 0 },
                vnstatDay('2026-11-03', 7, 8),
              ],
            },
          },
        ],
      }),
    ).toEqual({
      days: [{ date: '2026-11-03', rx: 7, tx: 8 }],
      updatedAt: null,
    });
  });
});

describe('resolveTrafficCycle', () => {
  it('starts on the reset day of this month once it has passed', () => {
    const { start, end } = resolveTrafficCycle(
      Date.parse('2026-11-11T08:00:00Z'),
      1,
    );
    expect(new Date(start).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('falls back to the previous month before the reset day', () => {
    const { start, end } = resolveTrafficCycle(
      Date.parse('2026-01-10T08:00:00Z'),
      15,
    );
    expect(new Date(start).toISOString()).toBe('2025-12-15T00:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });
});

describe('normalizeTrafficSettings', () => {
  it('falls back to safe defaults for invalid values', () => {
    expect(
      normalizeTrafficSettings({
        QuotaGB: -5,
        ResetDay: 31,
        RelayResumedCycle: 'x',
      }),
    ).toEqual({ QuotaGB: 0, ResetDay: 1 });
    expect(
      normalizeTrafficSettings({
        QuotaGB: 6000,
        ResetDay: 3,
        RelayResumedCycle: '2026-11-03',
      }),
    ).toEqual({ QuotaGB: 6000, ResetDay: 3, RelayResumedCycle: '2026-11-03' });
  });
});

describe('computeHostTrafficStatus', () => {
  const now = Date.parse('2026-11-11T00:00:00Z');
  const settings = { QuotaGB: 1000, ResetDay: 1 };

  it('counts inbound and outbound traffic inside the current cycle only', () => {
    const status = computeHostTrafficStatus({
      snapshot: snapshot(
        [
          ['2026-10-31', 500 * GB, 500 * GB],
          ['2026-11-01', 100 * GB, 50 * GB],
          ['2026-11-10', 100 * GB, 50 * GB],
        ],
        now,
      ),
      settings,
      now,
    });
    expect(status).toMatchObject({
      available: true,
      stale: false,
      cycleStart: '2026-11-01',
      cycleEnd: '2026-12-01',
      rxBytes: 200 * GB,
      txBytes: 100 * GB,
      usedBytes: 300 * GB,
      quotaBytes: 1000 * GB,
      usedRatio: 0.3,
      relay: 'active',
    });
    // 10 天用 300 GB，剩余 20 天按同速率再用 600 GB
    expect(status.projectedBytes).toBe(900 * GB);
  });

  it('projects from the first recorded day when monitoring started mid-cycle', () => {
    const status = computeHostTrafficStatus({
      snapshot: snapshot([['2026-11-10', 10 * GB, 10 * GB]], now),
      settings,
      now,
    });
    expect(status.projectedBytes).toBe(20 * GB + 20 * GB * 20);
  });

  it('keeps the projection and drops today once the stats stop updating', () => {
    const updatedAt = Date.parse('2026-11-01T12:00:00Z');
    const stopped = snapshot([['2026-11-01', 50 * GB, 50 * GB]], updatedAt);
    const atStop = computeHostTrafficStatus({
      snapshot: stopped,
      settings,
      now: updatedAt,
    });
    const later = computeHostTrafficStatus({
      snapshot: stopped,
      settings,
      now,
    });
    expect(later.projectedBytes).toBe(atStop.projectedBytes);
    expect(atStop.todayBytes).toBe(100 * GB);
    expect(later.todayBytes).toBe(0);
  });

  it('counts the host day that is still yesterday in UTC as today', () => {
    const status = computeHostTrafficStatus({
      snapshot: snapshot([['2026-11-10', 3 * GB, 1 * GB]], now),
      settings,
      now: Date.parse('2026-11-11T03:00:00Z'),
    });
    expect(status.todayBytes).toBe(4 * GB);
  });

  it('pauses relay at the pause line unless the owner resumed it this cycle', () => {
    const heavy = snapshot([['2026-11-05', 600 * GB, 360 * GB]], now);
    expect(
      computeHostTrafficStatus({ snapshot: heavy, settings, now }).relay,
    ).toBe('paused');
    expect(
      computeHostTrafficStatus({
        snapshot: heavy,
        settings: { ...settings, RelayResumedCycle: '2026-11-01' },
        now,
      }).relay,
    ).toBe('resumed');
    expect(
      computeHostTrafficStatus({
        snapshot: heavy,
        settings: { ...settings, RelayResumedCycle: '2026-10-01' },
        now,
      }).relay,
    ).toBe('paused');
  });

  it('never pauses without a quota and reports missing or stale stats', () => {
    const heavy = snapshot(
      [['2026-11-05', 9000 * GB, 0]],
      now - TRAFFIC_STALE_MS - 1,
    );
    const unlimited = computeHostTrafficStatus({
      snapshot: heavy,
      settings: { QuotaGB: 0, ResetDay: 1 },
      now,
    });
    expect(unlimited).toMatchObject({
      relay: 'active',
      usedRatio: null,
      stale: true,
    });
    expect(
      computeHostTrafficStatus({ snapshot: null, settings, now }),
    ).toMatchObject({
      available: false,
      usedBytes: 0,
      projectedBytes: null,
      relay: 'active',
    });
  });
});
