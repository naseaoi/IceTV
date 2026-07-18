import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AdminTabScrollPanel } from './AdminTabScrollPanel';

describe('AdminTabScrollPanel', () => {
  it('updates edge fades from the current scroll position', async () => {
    render(
      <AdminTabScrollPanel activeTab='video-source'>内容</AdminTabScrollPanel>,
    );
    const panel = screen.getByText('内容').parentElement;
    expect(panel).not.toBeNull();
    Object.defineProperties(panel!, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    fireEvent.scroll(panel!);
    await waitFor(() =>
      expect(panel).toHaveAttribute('data-bottom-fade', 'true'),
    );
    expect(panel).toHaveAttribute('data-top-fade', 'false');

    panel!.scrollTop = 100;
    fireEvent.scroll(panel!);
    await waitFor(() => expect(panel).toHaveAttribute('data-top-fade', 'true'));
    expect(panel).toHaveAttribute('data-bottom-fade', 'true');

    panel!.scrollTop = 300;
    fireEvent.scroll(panel!);
    await waitFor(() =>
      expect(panel).toHaveAttribute('data-bottom-fade', 'false'),
    );
    expect(panel).toHaveAttribute('data-top-fade', 'true');
  });
});
