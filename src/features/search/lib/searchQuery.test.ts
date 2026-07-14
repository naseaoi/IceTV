import { normalizeSearchQueryInput } from './searchQuery';

describe('normalizeSearchQueryInput', () => {
  it('removes invisible characters and normalizes spacing', () => {
    expect(normalizeSearchQueryInput('\u200b《对魔导\u3000学园》\ufeff')).toBe(
      '《对魔导 学园》',
    );
  });
});
