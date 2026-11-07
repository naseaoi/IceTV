import { fireEvent, render } from '@testing-library/react';

import AnimatedCount from '@/components/AnimatedCount';

describe('AnimatedCount', () => {
  it('renders the first value without animation', () => {
    const { container } = render(<AnimatedCount value={3} />);
    const root = container.firstElementChild;
    expect(root?.children).toHaveLength(1);
    expect(root?.firstElementChild).not.toHaveAttribute('class');
    expect(root).toHaveTextContent('3');
  });

  it('rolls the old value out in the direction of change', () => {
    const { container, rerender } = render(<AnimatedCount value={3} />);
    rerender(<AnimatedCount value={4} />);
    const [outgoing, incoming] = Array.from(
      container.firstElementChild?.children ?? [],
    );
    expect(outgoing).toHaveClass('count-roll-out-up');
    expect(outgoing).toHaveAttribute('aria-hidden', 'true');
    expect(outgoing).toHaveTextContent('3');
    expect(incoming).toHaveClass('count-roll-in-up');
    expect(incoming).toHaveTextContent('4');

    fireEvent.animationEnd(outgoing);
    expect(container.firstElementChild?.children).toHaveLength(1);

    rerender(<AnimatedCount value={2} />);
    expect(container.querySelector('.count-roll-in-down')).toHaveTextContent(
      '2',
    );
  });

  it('formats both values', () => {
    const { container, rerender } = render(
      <AnimatedCount value={99} format={(n) => (n > 99 ? '99+' : String(n))} />,
    );
    rerender(
      <AnimatedCount
        value={100}
        format={(n) => (n > 99 ? '99+' : String(n))}
      />,
    );
    expect(container).toHaveTextContent('9999+');
  });
});
