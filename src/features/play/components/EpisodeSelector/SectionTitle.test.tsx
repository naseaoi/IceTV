import { render, screen } from '@testing-library/react';

import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';

describe('SectionTitle', () => {
  it('renders the heading at the requested level', () => {
    render(<SectionTitle as='h3' label='我的评价' />);
    expect(
      screen.getByRole('heading', { name: '我的评价', level: 3 }),
    ).toBeInTheDocument();
  });

  it('shows a positive count and trailing actions', () => {
    render(
      <SectionTitle label='大家的评价' count={3}>
        <button type='button'>刷新</button>
      </SectionTitle>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
  });

  it('hides a zero count', () => {
    const { container } = render(<SectionTitle label='选集' count={0} />);
    expect(container).toHaveTextContent(/^选集$/);
  });
});
