import { getVerticalScrollMaskStyle } from '@/lib/scroll-edge-fade';

describe('getVerticalScrollMaskStyle', () => {
  it.each([
    [false, false, undefined],
    [true, false, 'transparent 0, #000 2rem, #000 100%'],
    [false, true, '#000 0, #000 calc(100% - 2rem), transparent 100%'],
    [
      true,
      true,
      'transparent 0, #000 2rem, #000 calc(100% - 2rem), transparent 100%',
    ],
  ])('returns the matching vertical mask', (top, bottom, expected) => {
    const style = getVerticalScrollMaskStyle(top, bottom);

    if (!expected) {
      expect(style).toBeUndefined();
      return;
    }

    expect(style?.maskImage).toContain(expected);
    expect(style?.WebkitMaskImage).toBe(style?.maskImage);
  });
});
