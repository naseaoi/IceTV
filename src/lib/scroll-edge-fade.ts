import type { CSSProperties } from 'react';

const TOP_FADE =
  'linear-gradient(to bottom, transparent 0, #000 2rem, #000 100%)';
const BOTTOM_FADE =
  'linear-gradient(to bottom, #000 0, #000 calc(100% - 2rem), transparent 100%)';
const BOTH_FADE =
  'linear-gradient(to bottom, transparent 0, #000 2rem, #000 calc(100% - 2rem), transparent 100%)';

export function getVerticalScrollMaskStyle(
  hasTopFade: boolean,
  hasBottomFade: boolean,
): CSSProperties | undefined {
  const maskImage = hasTopFade
    ? hasBottomFade
      ? BOTH_FADE
      : TOP_FADE
    : hasBottomFade
      ? BOTTOM_FADE
      : undefined;

  if (!maskImage) return undefined;

  return {
    WebkitMaskImage: maskImage,
    maskImage,
  };
}
