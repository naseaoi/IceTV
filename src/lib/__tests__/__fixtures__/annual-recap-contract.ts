import { emptyAnnualActivity } from '@/features/playback-stats/lib/annual-activity';
import { aggregateAnnualReport } from '@/features/playback-stats/lib/annual-report';
import { publicAnnualReport } from '@/features/playback-stats/lib/annual-share';
import { followRecapSortKey } from '@/lib/annual-recap-identity';
import type { IStorage } from '@/lib/types';

export async function assertAnnualRecapStorage(storage: IStorage) {
  const user = 'recap-storage-owner';
  const report = publicAnnualReport(
    aggregateAnnualReport({
      year: 2025,
      timeZone: 'UTC',
      now: 1767000000000,
      data: { sessions: [], buckets: [], earliestStartedAt: null },
      reviews: [],
      retentionDays: 0,
    }),
    [],
    true,
    emptyAnnualActivity(),
  );
  try {
    await storage.registerUser(user, 'password');
    expect(await storage.getAnnualRecap(user, 2025)).toBeNull();
    await storage.saveAnnualRecap(user.toUpperCase(), report, 1000);
    expect(await storage.getAnnualRecap(user, 2025)).toMatchObject({
      publishedAt: 1000,
      updatedAt: 1000,
      hideRhythm: true,
      report,
    });
    await storage.saveAnnualRecap(
      user,
      { ...report, rhythmHidden: false },
      2000,
    );
    expect(await storage.getAnnualRecap(user, 2025)).toMatchObject({
      publishedAt: 1000,
      updatedAt: 2000,
      hideRhythm: false,
    });
    await storage.saveAnnualRecap(user, report, 3000, {
      publishedAt: 1000,
      updatedAt: 1000,
    });
    expect((await storage.getAnnualRecap(user, 2025))?.updatedAt).toBe(2000);
    await storage.saveAnnualRecap(user, report, 3000, {
      publishedAt: 1000,
      updatedAt: 2000,
    });
    expect((await storage.getAnnualRecap(user, 2025))?.updatedAt).toBe(3000);
    await storage.saveAnnualRecap(user, { ...report, year: 2024 }, 3000);
    expect(await storage.getAnnualRecapYears(user)).toEqual([2025, 2024]);
    expect((await storage.getUserProfileView(user, 'other'))?.recap).toEqual({
      year: 2025,
    });
    await storage.deleteAnnualRecap(user, 2025);
    await storage.saveAnnualRecap(user, report, 4000, {
      publishedAt: 1000,
      updatedAt: 3000,
    });
    expect(await storage.getAnnualRecap(user, 2025)).toBeNull();
    await storage.saveAnnualRecap(user, report, 5000);
    expect((await storage.getAnnualRecap(user, 2025))?.publishedAt).toBe(5000);
  } finally {
    await storage.deleteUser(user);
  }
  expect(await storage.getAnnualRecapYears(user)).toEqual([]);
}

export async function assertAnnualRecapMessages(storage: IStorage) {
  const user = 'recap-message-owner';
  const reader = 'recap-message-reader';
  const report = publicAnnualReport(
    aggregateAnnualReport({
      year: 2025,
      timeZone: 'UTC',
      now: 1767000000000,
      data: { sessions: [], buckets: [], earliestStartedAt: null },
      reviews: [],
      retentionDays: 0,
    }),
    [],
    false,
    emptyAnnualActivity(),
  );
  try {
    await storage.registerUser(user, 'password');
    await storage.registerUser(reader, 'password');
    await storage.setUserFollow(reader, user, true);
    const now = Date.now() + 2000;
    await storage.saveAnnualRecap(user, report, now);
    await storage.saveAnnualRecap(user, { ...report, year: 2024 }, now);
    const items = await storage.getFollowRecapMessages(reader, 0, [], now, {
      limit: 1,
    });
    expect(items).toHaveLength(1);
    expect(items[0].year).toBe(2025);
    expect(JSON.stringify(items)).not.toContain(user);
    expect(await storage.getFollowRecapMessageCount(reader, 0, [], now)).toBe(
      2,
    );
    const next = await storage.getFollowRecapMessages(reader, 0, [], now, {
      before: { createdAt: now, key: followRecapSortKey(items[0].id) },
    });
    expect(next.map((item) => item.year)).toEqual([2024]);
    expect(
      await storage.getFollowRecapMessageCount(reader, 0, [items[0].id], now),
    ).toBe(1);
    expect(await storage.getFollowRecapMessageCount(reader, now, [], now)).toBe(
      0,
    );
    expect(
      await storage.getFollowRecapMessageCount(
        reader,
        0,
        [],
        now + 31 * 86400000,
      ),
    ).toBe(0);
    expect(
      await storage.getFollowRecapMessages(reader, 0, [], now, {
        id: items[0].id,
      }),
    ).toEqual(items);
    await storage.deleteAnnualRecap(user, 2025);
    expect(await storage.getFollowRecapMessageCount(reader, 0, [], now)).toBe(
      1,
    );
    await storage.setUserFollow(reader, user, false);
    expect(await storage.getFollowRecapMessageCount(reader, 0, [], now)).toBe(
      0,
    );
  } finally {
    await storage.deleteUser(reader);
    await storage.deleteUser(user);
  }
}
