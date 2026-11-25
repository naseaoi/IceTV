import { render } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';

import { TrackingStripSkeleton } from './TrackingStrip';

jest.mock('next/navigation', () => ({ useSearchParams: jest.fn() }));

function renderWithFilter(filter: string | null, count: number) {
  jest
    .mocked(useSearchParams)
    .mockReturnValue(
      new URLSearchParams(filter ? { filter } : {}) as unknown as ReturnType<
        typeof useSearchParams
      >,
    );
  return render(<TrackingStripSkeleton count={count} />);
}

it('骨架只在全部筛选且条数已知大于 0 时占位，条数跟随计数', () => {
  const { container } = renderWithFilter(null, 3);
  expect(container.querySelectorAll('.w-64')).toHaveLength(3);
});

it.each([
  ['updated', 3],
  ['shelved', 3],
  [null, 0],
])('筛选 %s、条数 %s 时不占位', (filter, count) => {
  const { container } = renderWithFilter(filter, count);
  expect(container).toBeEmptyDOMElement();
});
