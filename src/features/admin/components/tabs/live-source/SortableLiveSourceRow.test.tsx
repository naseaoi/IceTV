import { fireEvent, render, screen } from '@testing-library/react';

import { SortableLiveSourceRow } from './SortableLiveSourceRow';

jest.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
  }),
}));

describe('SortableLiveSourceRow', () => {
  it('renders status as a switch without text', () => {
    const onToggleEnable = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    render(
      <ul>
        <SortableLiveSourceRow
          liveSource={{
            name: '测试直播源',
            key: 'test-live-source',
            url: 'https://example.com/live.m3u',
            disabled: true,
            from: 'custom',
          }}
          isToggleLoading={false}
          isEditLoading={false}
          isDeleteLoading={false}
          onToggleEnable={onToggleEnable}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </ul>,
    );

    const statusSwitch = screen.getByRole('switch', {
      name: '测试直播源状态',
    });
    expect(statusSwitch).toHaveAttribute('aria-checked', 'false');
    expect(statusSwitch).toHaveTextContent('');

    fireEvent.click(statusSwitch);
    expect(onToggleEnable).toHaveBeenCalledWith('test-live-source');
    expect(screen.getByText('已停用')).toBeInTheDocument();
    const menu = screen.getByRole('button', { name: '测试直播源 的操作' });
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }));
    expect(onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'test-live-source' }),
    );
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(onDelete).toHaveBeenCalledWith('test-live-source');
  });
});
