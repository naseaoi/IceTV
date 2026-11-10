import type { IStorage, SiteAnnouncement } from '@/lib/types';

export function announcementContract(createStorage: () => IStorage) {
  let storage: IStorage;
  const item = (
    id: string,
    createdAt: number,
    publishedAt: number | null,
  ): SiteAnnouncement => ({
    id,
    content: `Content ${id}`,
    createdAt,
    updatedAt: createdAt,
    publishedAt,
  });
  beforeEach(() => {
    storage = createStorage();
  });

  it('lists drafts first and applies timestamp/id ordering and SQL limits', async () => {
    for (const row of [
      item('draft-old', 10, null),
      item('draft-A', 20, null),
      item('draft-a', 20, null),
      item('pub-A', 999, 100),
      item('pub-a', 1, 100),
      item('pub-new', 0, 200),
    ])
      await storage.createAnnouncement(row);
    expect((await storage.listAnnouncements(20)).map((row) => row.id)).toEqual([
      'draft-a',
      'draft-A',
      'draft-old',
      'pub-new',
      'pub-a',
      'pub-A',
    ]);
    expect((await storage.listAnnouncements(2)).map((row) => row.id)).toEqual([
      'draft-a',
      'draft-A',
    ]);
    expect(await storage.listAnnouncements(0)).toEqual([]);
    expect(await storage.countAnnouncements()).toBe(6);
  });

  it('filters published rows and pages timestamp ties with case-sensitive ids', async () => {
    for (const row of [
      item('draft', 500, null),
      item('zero', 1, 0),
      item('old', 2, 50),
      item('A', 3, 100),
      item('a', 4, 100),
      item('new', 5, 200),
    ]) {
      await storage.createAnnouncement(row);
    }
    expect(
      (await storage.getPublishedAnnouncements({ limit: 20 })).map(
        (row) => row.id,
      ),
    ).toEqual(['new', 'a', 'A', 'old', 'zero']);
    expect(
      (await storage.getPublishedAnnouncements({ since: 0, limit: 20 })).map(
        (row) => row.id,
      ),
    ).toEqual(['new', 'a', 'A', 'old']);
    expect(
      (await storage.getPublishedAnnouncements({ since: 100, limit: 20 })).map(
        (row) => row.id,
      ),
    ).toEqual(['new']);
    expect(
      (await storage.getPublishedAnnouncements({ limit: 2 })).map(
        (row) => row.id,
      ),
    ).toEqual(['new', 'a']);
    const before = { publishedAt: 100, id: 'a' };
    expect(
      (await storage.getPublishedAnnouncements({ before, limit: 20 })).map(
        (row) => row.id,
      ),
    ).toEqual(['A', 'old', 'zero']);
    expect(
      (
        await storage.getPublishedAnnouncements({
          since: 50,
          before,
          limit: 20,
        })
      ).map((row) => row.id),
    ).toEqual(['A']);
    expect(await storage.getPublishedAnnouncements({ limit: 0 })).toEqual([]);
  });

  it('updates only supplied fields, publishes and withdraws, and returns missing rows as null', async () => {
    const original = item('row', 1700000000000, null);
    expect(await storage.getAnnouncement('missing')).toBeNull();
    expect(
      await storage.updateAnnouncement('missing', { updatedAt: 1 }),
    ).toBeNull();
    await storage.createAnnouncement(original);
    expect(await storage.getAnnouncement('row')).toEqual(original);
    expect(await storage.getAnnouncement('ROW')).toBeNull();
    expect(
      await storage.updateAnnouncement('row', {
        publishedAt: 1700000000100,
        updatedAt: 1700000000100,
      }),
    ).toEqual({
      ...original,
      publishedAt: 1700000000100,
      updatedAt: 1700000000100,
    });
    expect(
      await storage.updateAnnouncement('row', {
        content: '',
        updatedAt: 1700000000200,
      }),
    ).toEqual({
      ...original,
      content: '',
      publishedAt: 1700000000100,
      updatedAt: 1700000000200,
    });
    const withdrawn = { ...original, content: '', updatedAt: 1700000000300 };
    expect(
      await storage.updateAnnouncement('row', {
        publishedAt: null,
        updatedAt: 1700000000300,
      }),
    ).toEqual(withdrawn);
    expect(await storage.getPublishedAnnouncements({ limit: 10 })).toEqual([]);
    expect(
      await storage.updateAnnouncement('row', { updatedAt: 1700000000300 }),
    ).toEqual(withdrawn);
    expect(await storage.getAnnouncement('row')).toEqual(withdrawn);
  });

  it('returns whether deletion removed an exact id', async () => {
    await storage.createAnnouncement(item('row', 1, 2));
    expect(await storage.deleteAnnouncement('ROW')).toBe(false);
    expect(await storage.deleteAnnouncement('row')).toBe(true);
    expect(await storage.deleteAnnouncement('row')).toBe(false);
    expect(await storage.getAnnouncement('row')).toBeNull();
  });
}
