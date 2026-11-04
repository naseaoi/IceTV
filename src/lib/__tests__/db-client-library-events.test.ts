import { createOptimisticWriter } from '@/lib/db.client.internal';

it.each(['favoritesUpdated', 'playRecordsUpdated'] as const)(
  'invalidates server library only after %s mutation settles',
  async (eventName) => {
    const invalidate = jest.fn();
    window.addEventListener('userLibraryUpdated', invalidate);
    let resolve!: () => void;
    const writer = createOptimisticWriter({
      getCached: () => ({}),
      setCached: jest.fn(),
      eventName,
      emptyCacheFactory: () => ({}),
    });
    try {
      const pending = writer({
        mutateCached: (value) => value,
        syncToServer: () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      });
      expect(invalidate).not.toHaveBeenCalled();
      resolve();
      await pending;
      expect(invalidate).toHaveBeenCalledTimes(1);
      const rollback = jest.fn().mockResolvedValue(undefined);
      await expect(
        writer({
          mutateCached: (value) => value,
          syncToServer: async () => {
            throw new Error('failed');
          },
          onServerError: rollback,
        }),
      ).rejects.toThrow('failed');
      expect(rollback).toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('userLibraryUpdated', invalidate);
    }
  },
);
