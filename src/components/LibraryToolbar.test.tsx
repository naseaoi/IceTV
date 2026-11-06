import { render } from '@testing-library/react';

import { LibraryToolbar } from './LibraryToolbar';

jest.mock('@/components/Select', () => ({
  __esModule: true,
  default: () => null,
}));

function renderToolbar(countsKey: string, count: number, loading: boolean) {
  return render(
    <LibraryToolbar
      countsKey={countsKey}
      searchLabel='搜索'
      query=''
      onQueryChange={jest.fn()}
      filterOptions={[{ value: 'all', label: '全部', count }]}
      filter='all'
      onFilterChange={jest.fn()}
      sortOptions={[{ value: 'new', label: '最新' }]}
      sort='new'
      onSortChange={jest.fn()}
      loading={loading}
    />,
  );
}

function placeholderText(container: HTMLElement) {
  return container.querySelector('button[aria-pressed] .invisible')
    ?.textContent;
}

describe('LibraryToolbar', () => {
  it('再次加载时计数占位沿用上次显示的位数', () => {
    const first = renderToolbar('digits', 0, true);
    expect(placeholderText(first.container)).toBe('0');
    first.unmount();

    renderToolbar('digits', 128, false).unmount();

    const again = renderToolbar('digits', 0, true);
    expect(placeholderText(again.container)).toBe('000');
    again.unmount();

    const other = renderToolbar('other', 0, true);
    expect(placeholderText(other.container)).toBe('0');
  });
});
