import { fireEvent, render, screen } from '@testing-library/react';

import { PanelActionButton } from '@/features/play/components/EpisodeSelector/PanelActionButton';

describe('PanelActionButton', () => {
  it('uses compact neutral styling without overriding the accessible name', () => {
    const onClick = jest.fn();
    render(
      <PanelActionButton
        aria-label='Reload comments'
        className='self-start'
        onClick={onClick}
      >
        Reload
      </PanelActionButton>,
    );
    const button = screen.getByRole('button', { name: 'Reload comments' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass(
      'h-7',
      'text-xs',
      'bg-transparent',
      'text-gray-500',
      'self-start',
    );
    expect(button).toHaveAttribute('aria-busy', 'false');
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('preserves the label footprint while spinning and blocks duplicate clicks', () => {
    const onClick = jest.fn();
    const { rerender } = render(
      <PanelActionButton onClick={onClick}>Reload</PanelActionButton>,
    );
    const button = screen.getByRole('button', { name: 'Reload' });
    const idleClassName = button.className;
    rerender(
      <PanelActionButton onClick={onClick} busy>
        Reload
      </PanelActionButton>,
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.className).toBe(idleClassName);
    expect(button.querySelector('span')).toHaveTextContent('Reload');
    expect(button.querySelector('span')).toHaveClass('opacity-0');
    expect(screen.getByRole('button', { name: 'Reload' })).toBe(button);
    expect(button.querySelector('svg')).toHaveClass(
      'absolute',
      'h-3.5',
      'w-3.5',
      'animate-spin',
    );
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    rerender(<PanelActionButton onClick={onClick}>Reload</PanelActionButton>);
    expect(button).toBeEnabled();
    expect(button.querySelector('svg')).not.toBeInTheDocument();
  });

  it('keeps an explicitly disabled action disabled after loading', () => {
    const { rerender } = render(
      <PanelActionButton disabled busy>
        Reload
      </PanelActionButton>,
    );
    rerender(<PanelActionButton disabled>Reload</PanelActionButton>);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
  });
});
