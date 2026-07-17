import { fireEvent, render, screen } from '@testing-library/react';

import { SortableSourceRow } from './SortableSourceRow';

jest.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
  }),
}));

describe('SortableSourceRow', () => {
  const source = {
    name: '测试源',
    key: 'test-source',
    api: 'https://example.com/api',
    disabled: false,
    from: 'custom' as const,
    proxyMode: 'auto' as const,
  };

  function renderRow({
    onToggleEnable = jest.fn(),
    onChangeProxyMode = jest.fn(),
  } = {}) {
    render(
      <table>
        <tbody>
          <SortableSourceRow
            source={source}
            isSelected={false}
            validationStatus={null}
            sourceRouteStats={null}
            isProxyModeLoading={false}
            isToggleLoading={false}
            isDeleteLoading={false}
            isValidationLoading={false}
            onSelectSource={jest.fn()}
            onChangeProxyMode={onChangeProxyMode}
            onToggleEnable={onToggleEnable}
            onValidate={jest.fn()}
            onEdit={jest.fn()}
            onDelete={jest.fn()}
          />
        </tbody>
      </table>,
    );
    return { onToggleEnable, onChangeProxyMode };
  }

  it('renders status as an explicit switch', () => {
    const { onToggleEnable } = renderRow();
    const statusSwitch = screen.getByRole('switch', { name: '测试源状态' });

    expect(statusSwitch).toHaveAttribute('aria-checked', 'true');
    expect(statusSwitch).toHaveTextContent('');

    fireEvent.click(statusSwitch);
    expect(onToggleEnable).toHaveBeenCalledWith('test-source');
  });

  it('selects a proxy mode directly', () => {
    const { onChangeProxyMode } = renderRow();
    const routeSelect = screen.getByRole('button', {
      name: '测试源流量路由',
    });

    expect(routeSelect).toHaveTextContent('自动');
    fireEvent.click(routeSelect);
    const selectedOption = screen.getByRole('option', { name: '自动' });
    expect(selectedOption).toHaveClass('bg-green-50');
    expect(selectedOption.querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: '代理' }));

    expect(onChangeProxyMode).toHaveBeenCalledWith('test-source', 'server');
  });
});
