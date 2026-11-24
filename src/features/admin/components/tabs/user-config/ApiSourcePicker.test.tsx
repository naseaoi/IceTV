import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import type { DataSource } from '@/features/admin/types/internal';

import { ApiSourcePicker } from './ApiSourcePicker';

jest.mock('@/features/admin/hooks/useSourceInsights', () => ({
  useSourceInsights: () => ({
    routeStats: [],
    health: new Map([['relay', { tier: 'poor' }]]),
  }),
}));

const sources: DataSource[] = [
  {
    key: 'direct-a',
    name: '直连甲',
    api: 'https://a.test/api',
    from: 'config',
  },
  {
    key: 'relay',
    name: '中转乙',
    api: 'https://b.test/api',
    from: 'config',
    proxyMode: 'server',
  },
  {
    key: 'direct-c',
    name: '直连丙',
    api: 'https://c.test/api',
    from: 'config',
    disabled: true,
  },
];

function renderPicker(selected: string[] = []) {
  const onChange = jest.fn();
  render(
    <ApiSourcePicker
      sources={sources}
      selected={selected}
      onChange={onChange}
    />,
  );
  return onChange;
}

function chooseFilter(label: RegExp, dimension = '筛选视频源') {
  fireEvent.click(screen.getByRole('button', { name: dimension }));
  fireEvent.click(screen.getByRole('option', { name: label }));
}

describe('ApiSourcePicker', () => {
  it('按线路筛选并只显示命中的视频源', () => {
    renderPicker();

    chooseFilter(/^代理$/);

    expect(screen.getByText('中转乙')).toBeTruthy();
    expect(screen.queryByText('直连甲')).toBeNull();
  });

  it('全选只追加当前筛选结果中未禁用的视频源', () => {
    const onChange = renderPicker(['relay']);

    chooseFilter(/^直连或自动$/);
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));

    expect(onChange).toHaveBeenCalledWith(['relay', 'direct-a']);
  });

  it('取消全选只移除当前筛选结果', () => {
    const onChange = renderPicker(['relay', 'direct-a']);

    chooseFilter(/^直连或自动$/);
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));

    expect(onChange).toHaveBeenCalledWith(['relay']);
  });

  it('在未选筛选下全选后条目保留在列表中，重新筛选才刷新', () => {
    function ControlledPicker() {
      const [selected, setSelected] = useState<string[]>([]);
      return (
        <ApiSourcePicker
          sources={sources}
          selected={selected}
          onChange={setSelected}
        />
      );
    }
    render(<ControlledPicker />);

    chooseFilter(/^未选$/, '筛选勾选状态');
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));

    expect(screen.getByRole('checkbox', { name: '全选' })).toBeChecked();
    expect(screen.getByText('直连甲')).toBeTruthy();
    expect(screen.getByText('中转乙')).toBeTruthy();

    chooseFilter(/^未选$/, '筛选勾选状态');

    expect(screen.queryByText('直连甲')).toBeNull();
    expect(screen.getByText('直连丙')).toBeTruthy();
  });

  it('勾选与源条件取交集，并支持待清理和禁用源', () => {
    renderPicker(['relay', 'direct-c']);
    chooseFilter(/^已选$/, '筛选勾选状态');
    chooseFilter(/^待清理$/);
    expect(screen.getByText('中转乙')).toBeInTheDocument();
    expect(screen.queryByText('直连丙')).not.toBeInTheDocument();
    chooseFilter(/^已禁用$/);
    expect(screen.getByText('直连丙')).toBeInTheDocument();
    expect(screen.queryByText('中转乙')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '全选' })).toBeDisabled();
    chooseFilter(/^未选$/, '筛选勾选状态');
    expect(screen.getByText('没有符合条件的视频源')).toBeInTheDocument();
  });

  it('切换源条件保持已选快照，重新选择勾选条件才刷新', () => {
    function ControlledPicker() {
      const [selected, setSelected] = useState(['relay']);
      return (
        <ApiSourcePicker
          sources={sources}
          selected={selected}
          onChange={setSelected}
        />
      );
    }
    render(<ControlledPicker />);
    chooseFilter(/^已选$/, '筛选勾选状态');
    fireEvent.click(screen.getByRole('checkbox', { name: /中转乙/ }));
    chooseFilter(/^代理$/);
    expect(screen.getByText('中转乙')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /中转乙/ })).not.toBeChecked();
    chooseFilter(/^已选$/, '筛选勾选状态');
    expect(screen.getByText('没有符合条件的视频源')).toBeInTheDocument();
  });

  it('搜索无结果时显示空状态', () => {
    renderPicker();

    fireEvent.change(screen.getByLabelText('搜索视频源'), {
      target: { value: 'nothing' },
    });

    expect(screen.getByText('没有符合条件的视频源')).toBeTruthy();
  });
});
