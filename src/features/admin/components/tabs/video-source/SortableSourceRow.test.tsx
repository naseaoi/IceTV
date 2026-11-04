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
    onEdit = jest.fn(),
    onValidate = jest.fn(),
    onDelete = jest.fn(),
  } = {}) {
    render(
      <ul>
        <SortableSourceRow
          source={source}
          isSelected={false}
          validationStatus={null}
          sourceRouteStats={null}
          sourceHealth={null}
          healthDays={7}
          isProxyModeLoading={false}
          isToggleLoading={false}
          isDeleteLoading={false}
          isValidationLoading={false}
          onSelectSource={jest.fn()}
          onChangeProxyMode={onChangeProxyMode}
          onToggleEnable={onToggleEnable}
          onValidate={onValidate}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </ul>,
    );
    return { onToggleEnable, onChangeProxyMode, onEdit, onValidate, onDelete };
  }

  it('renders status as an explicit switch', () => {
    const { onToggleEnable } = renderRow();
    const statusSwitch = screen.getByRole('switch', { name: '测试源状态' });

    expect(statusSwitch).toHaveAttribute('aria-checked', 'true');
    expect(statusSwitch).toHaveTextContent('');

    fireEvent.click(statusSwitch);
    expect(onToggleEnable).toHaveBeenCalledWith('test-source');
  });

  it('opens edit, validation and delete from the row menu', () => {
    const { onEdit, onValidate, onDelete } = renderRow();
    const trigger = screen.getByRole('button', { name: '测试源 的操作' });
    for (const label of ['编辑', '检测', '删除']) {
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    }
    expect(onEdit).toHaveBeenCalledWith(source);
    expect(onValidate).toHaveBeenCalledWith(source.key);
    expect(onDelete).toHaveBeenCalledWith(source.key);
    expect(screen.getByTitle('7天成功率 · 直连 — · 代理 —')).toHaveTextContent(
      '直连 — · 代理 —',
    );
  });

  it('selects a proxy mode directly', () => {
    const { onChangeProxyMode } = renderRow();
    const routeSelect = screen.getByRole('button', {
      name: '测试源流量路由',
    });

    expect(routeSelect).toHaveTextContent('自动');
    fireEvent.click(routeSelect);
    const selectedOption = screen.getByRole('option', { name: '自动' });
    expect(selectedOption).toHaveAttribute('aria-selected', 'true');
    expect(selectedOption.querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: '代理' }));

    expect(onChangeProxyMode).toHaveBeenCalledWith('test-source', 'server');
  });
});
