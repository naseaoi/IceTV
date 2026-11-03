import { render, screen } from '@testing-library/react';

import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';

describe('SectionTitle', () => {
  it('renders a plain muted heading without decorative children', () => {
    render(<SectionTitle label='选集' />);
    const heading = screen.getByRole('heading', { name: '选集', level: 4 });
    expect(heading).toHaveClass('min-h-7', 'items-center', 'font-medium');
    expect(heading.firstElementChild).toBeNull();
  });

  it('supports the same styling for top-level panel sections', () => {
    render(<SectionTitle as='h3' label='源站列表' />);
    expect(
      screen.getByRole('heading', { name: '源站列表', level: 3 }),
    ).toHaveClass('min-h-7', 'font-medium');
  });
});
