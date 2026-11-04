import { fireEvent, render, screen } from '@testing-library/react';

import { SortableCategoryRow } from './SortableCategoryRow';

jest.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
  }),
}));

describe('SortableCategoryRow', () => {
  it('uses switch, edit, and delete actions', () => {
    const category = {
      name: '热门电影',
      type: 'movie' as const,
      query: '热门',
      disabled: false,
      from: 'custom' as const,
    };
    const onToggleEnable = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    render(
      <ul>
        <SortableCategoryRow
          category={category}
          isToggleLoading={false}
          isDeleteLoading={false}
          onToggleEnable={onToggleEnable}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </ul>,
    );

    fireEvent.click(screen.getByRole('switch', { name: '热门电影状态' }));
    fireEvent.click(screen.getByRole('button', { name: '热门电影 的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '热门电影 的操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));

    expect(onToggleEnable).toHaveBeenCalledWith(category);
    expect(onEdit).toHaveBeenCalledWith(category);
    expect(onDelete).toHaveBeenCalledWith(category);
  });

  it('disables edit and delete while status is changing', () => {
    render(
      <ul>
        <SortableCategoryRow
          category={{
            name: '热门电影',
            type: 'movie',
            query: '热门',
            disabled: false,
            from: 'custom',
          }}
          isToggleLoading
          isDeleteLoading={false}
          onToggleEnable={jest.fn()}
          onEdit={jest.fn()}
          onDelete={jest.fn()}
        />
      </ul>,
    );

    fireEvent.click(screen.getByRole('button', { name: '热门电影 的操作' }));
    expect(screen.getByRole('menuitem', { name: '编辑' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeDisabled();
  });
});
