import { createCacheBudgetLedger } from '../cache-budget';

describe('cache budget ledger', () => {
  it('restores existing entries and evicts the oldest by byte budget', () => {
    const ledger = createCacheBudgetLedger<string>({
      maxEntries: 4,
      maxBytes: 10,
    });
    ledger.initialize([
      { key: 'a', bytes: 4 },
      { key: 'b', bytes: 4 },
    ]);

    expect(ledger.reserve('c', 5)).toEqual(['a']);
    expect(ledger.stats()).toEqual({
      initialized: true,
      entries: 2,
      totalBytes: 9,
    });
  });

  it('keeps the configured entry limit during incremental writes', () => {
    const ledger = createCacheBudgetLedger<string>({
      maxEntries: 2,
      maxBytes: 100,
    });
    ledger.initialize([{ key: 'a', bytes: 10 }]);

    expect(ledger.reserve('b', 10)).toEqual([]);
    expect(ledger.reserve('c', 10)).toEqual(['a']);
    expect(ledger.stats()).toEqual({
      initialized: true,
      entries: 2,
      totalBytes: 20,
    });
  });

  it('replaces reservations without double counting bytes', () => {
    const ledger = createCacheBudgetLedger<string>({
      maxEntries: 4,
      maxBytes: 100,
    });
    ledger.initialize([{ key: 'a', bytes: 40 }]);

    expect(ledger.reserve('a', 25)).toEqual([]);
    expect(ledger.stats().totalBytes).toBe(25);
  });
});
