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
    render(
      <table>
        <tbody>
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
            onEdit={jest.fn()}
            onDelete={jest.fn()}
          />
        </tbody>
      </table>,
    );

    const statusSwitch = screen.getByRole('switch', {
      name: '测试直播源状态',
    });
    expect(statusSwitch).toHaveAttribute('aria-checked', 'false');
    expect(statusSwitch).toHaveTextContent('');

    fireEvent.click(statusSwitch);
    expect(onToggleEnable).toHaveBeenCalledWith('test-live-source');
  });
});
