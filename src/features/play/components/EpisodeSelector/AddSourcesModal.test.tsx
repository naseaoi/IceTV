import { fireEvent, render, screen } from '@testing-library/react';

import { AddSourcesModal } from '@/features/play/components/EpisodeSelector/AddSourcesModal';
import type { SearchResult } from '@/lib/types';

function createSource(id: string, sourceName: string): SearchResult {
  return {
    id,
    title: 'test',
    poster: '',
    episodes: ['ep1'],
    episodes_titles: ['1'],
    source: `source-${id}`,
    source_name: sourceName,
  } as SearchResult;
}

const originalResizeObserver = global.ResizeObserver;

beforeAll(() => {
  global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
});

afterAll(() => {
  global.ResizeObserver = originalResizeObserver;
});

it('全选只选中未添加的源站，再次点击取消全选', () => {
  const candidates = [
    createSource('1', 'Source A'),
    createSource('2', 'Source B'),
    createSource('3', 'Source C'),
  ];
  const onConfirm = jest.fn();
  render(
    <AddSourcesModal
      isOpen
      candidates={candidates}
      existingKeys={new Set(['source-1-1'])}
      onConfirm={onConfirm}
      onCancel={jest.fn()}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '全选' }));
  fireEvent.click(screen.getByRole('button', { name: '添加 2 个源站' }));
  expect(onConfirm).toHaveBeenCalledWith([candidates[1], candidates[2]]);

  fireEvent.click(screen.getByRole('button', { name: '取消全选' }));
  expect(screen.getByRole('button', { name: '请选择源站' })).toBeDisabled();
});
