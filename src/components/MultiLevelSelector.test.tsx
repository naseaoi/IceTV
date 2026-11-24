import { fireEvent, render, screen } from '@testing-library/react';

import MultiLevelSelector, {
  getYearOptions,
} from '@/components/MultiLevelSelector';

describe('MultiLevelSelector', () => {
  it('shows the selections passed in by the parent', () => {
    render(
      <MultiLevelSelector
        contentType='tv'
        value={{
          type: 'all',
          region: '日本',
          year: 'all',
          platform: 'all',
          label: 'all',
          sort: 'S',
        }}
        onChange={jest.fn()}
      />,
    );

    expect(screen.getByText('日本')).toBeInTheDocument();
    expect(screen.getByText('高分优先')).toBeInTheDocument();
    expect(screen.getByText('类型')).toBeInTheDocument();
  });
});

it.each([2026, 2030, 2035])(
  '按运行时年份 %i 生成当前年代与上一年代过渡年',
  (year) => {
    const decade = Math.floor(year / 10) * 10;
    const options = getYearOptions(year);
    expect(options[1]).toEqual({ label: `${decade}年代`, value: `${decade}s` });
    expect(
      options.slice(2, 3 + year - decade).map((option) => option.value),
    ).toEqual(
      Array.from({ length: year - decade + 1 }, (_, index) =>
        String(year - index),
      ),
    );
    expect(options[3 + year - decade].value).toBe(String(decade - 1));
    expect(options[4 + year - decade].value).toBe(`${decade - 10}s`);
    expect(options.at(-1)?.value).toBe('earlier');
  },
);

it('运行时年份更新，年份与年代向父组件传递豆瓣标签', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-06-01T00:00:00Z'));
  try {
    const onChange = jest.fn();
    const { rerender } = render(
      <MultiLevelSelector value={{}} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '年代' }));
    fireEvent.click(screen.getByRole('button', { name: '2026' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ year: '2026' }),
    );
    jest.setSystemTime(new Date('2030-06-01T00:00:00Z'));
    rerender(<MultiLevelSelector value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '年代' }));
    fireEvent.click(screen.getByRole('button', { name: '2030年代' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ year: '2030年代' }),
    );
  } finally {
    jest.useRealTimers();
  }
});
