import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { useVerticalScrollEdgeFade } from './useVerticalScrollEdgeFade';

function ScrollPanel() {
  const fade = useVerticalScrollEdgeFade();

  return (
    <div
      ref={fade.ref}
      data-testid='scroll-panel'
      data-top-fade={fade.hasTopFade}
      data-bottom-fade={fade.hasBottomFade}
      onScroll={fade.onScroll}
      style={fade.style}
    >
      内容
    </div>
  );
}

function ConditionalScrollPanel() {
  const [visible, setVisible] = useState(false);
  const fade = useVerticalScrollEdgeFade();

  return (
    <>
      <button type='button' onClick={() => setVisible(true)}>
        显示面板
      </button>
      {visible && (
        <div
          ref={fade.ref}
          data-testid='conditional-scroll-panel'
          data-bottom-fade={fade.hasBottomFade}
          onScroll={fade.onScroll}
          style={fade.style}
        />
      )}
    </>
  );
}

describe('useVerticalScrollEdgeFade', () => {
  it('updates both edge fades from the current scroll position', async () => {
    render(<ScrollPanel />);
    const panel = screen.getByTestId('scroll-panel');

    Object.defineProperties(panel, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    fireEvent.scroll(panel);
    await waitFor(() =>
      expect(panel).toHaveAttribute('data-bottom-fade', 'true'),
    );
    expect(panel).toHaveAttribute('data-top-fade', 'false');
    expect(panel.style.maskImage).toContain('transparent 100%');

    panel.scrollTop = 100;
    fireEvent.scroll(panel);
    await waitFor(() => expect(panel).toHaveAttribute('data-top-fade', 'true'));
    expect(panel).toHaveAttribute('data-bottom-fade', 'true');

    panel.scrollTop = 300;
    fireEvent.scroll(panel);
    await waitFor(() =>
      expect(panel).toHaveAttribute('data-bottom-fade', 'false'),
    );
    expect(panel).toHaveAttribute('data-top-fade', 'true');
  });

  it('initializes after a tab mounts its scroll panel', async () => {
    render(<ConditionalScrollPanel />);

    fireEvent.click(screen.getByRole('button', { name: '显示面板' }));
    const panel = screen.getByTestId('conditional-scroll-panel');
    Object.defineProperties(panel, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    fireEvent.scroll(panel);
    await waitFor(() =>
      expect(panel).toHaveAttribute('data-bottom-fade', 'true'),
    );
  });
});
