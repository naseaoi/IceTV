import { render } from '@testing-library/react';

import { PosterWallBackdrop } from './PosterWallBackdrop';

describe('PosterWallBackdrop', () => {
  it('bounds the animated poster nodes and image set', () => {
    const { container } = render(<PosterWallBackdrop />);
    const images = Array.from(container.querySelectorAll('img'));
    const sources = new Set(images.map((image) => image.getAttribute('src')));

    expect(images).toHaveLength(160);
    expect(sources.size).toBe(16);
  });
});
