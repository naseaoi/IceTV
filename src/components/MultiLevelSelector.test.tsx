import { render, screen } from '@testing-library/react';

import MultiLevelSelector from '@/components/MultiLevelSelector';

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
