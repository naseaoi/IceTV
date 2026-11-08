import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import type { DataSource } from '@/features/admin/types/internal';

import { ApiSourcePicker } from './ApiSourcePicker';

jest.mock('@/features/admin/hooks/useSourceInsights', () => ({
  useSourceInsights: () => ({
    routeStats: [],
    capabilities: { relay: { direct: 'blocked' } },
    health: new Map(),
  }),
}));

const sources: DataSource[] = [
  {
    key: 'direct-a',
    name: '直连甲',
    api: 'https://a.test/api',
    from: 'config',
  },
  { key: 'relay', name: '中转乙', api: 'https://b.test/api', from: 'config' },
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

function chooseFilter(label: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: '筛选视频源' }));
  fireEvent.click(screen.getByRole('option', { name: label }));
}

describe('ApiSourcePicker', () => {
  it('按线路筛选并只显示命中的视频源', () => {
    renderPicker();

    chooseFilter(/^需中转 1$/);

    expect(screen.getByText('中转乙')).toBeTruthy();
    expect(screen.queryByText('直连甲')).toBeNull();
  });

  it('全选只追加当前筛选结果中未禁用的视频源', () => {
    const onChange = renderPicker(['relay']);

    chooseFilter(/^不需中转 2$/);
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));

    expect(onChange).toHaveBeenCalledWith(['relay', 'direct-a']);
  });

  it('取消全选只移除当前筛选结果', () => {
    const onChange = renderPicker(['relay', 'direct-a']);

    chooseFilter(/^不需中转 2$/);
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

    chooseFilter(/^未选 3$/);
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));

    expect(screen.getByRole('checkbox', { name: '全选' })).toBeChecked();
    expect(screen.getByText('直连甲')).toBeTruthy();
    expect(screen.getByText('中转乙')).toBeTruthy();

    chooseFilter(/^未选 1$/);

    expect(screen.queryByText('直连甲')).toBeNull();
    expect(screen.getByText('直连丙')).toBeTruthy();
  });

  it('搜索无结果时显示空状态', () => {
    renderPicker();

    fireEvent.change(screen.getByLabelText('搜索视频源'), {
      target: { value: 'nothing' },
    });

    expect(screen.getByText('没有符合条件的视频源')).toBeTruthy();
  });
});
