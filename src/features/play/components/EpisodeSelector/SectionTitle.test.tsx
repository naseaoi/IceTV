import { render, screen } from '@testing-library/react';

import { SectionTitle } from '@/features/play/components/EpisodeSelector/SectionTitle';

describe('SectionTitle', () => {
  it('renders a decorative vertical accent without changing the heading name', () => {
    render(<SectionTitle label='选集' />);
    const heading = screen.getByRole('heading', { name: '选集', level: 4 });
    expect(heading).toHaveClass(
      'min-h-7',
      'items-center',
      'gap-2',
      'font-semibold',
    );
    expect(heading.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(heading.firstElementChild).toHaveClass(
      'h-3.5',
      'w-[3px]',
      'rounded-full',
      'bg-green-500',
      'dark:bg-green-400',
    );
  });

  it('supports the same styling for top-level panel sections', () => {
    render(<SectionTitle as='h3' label='源站列表' />);
    expect(
      screen.getByRole('heading', { name: '源站列表', level: 3 }),
    ).toHaveClass('min-h-7', 'font-semibold');
  });
});
