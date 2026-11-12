import { fireEvent, render, screen } from '@testing-library/react';

import { LinuxDoBindingTile } from '@/components/user-menu/LinuxDoBindingTile';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

it('绑定信息失败可重试，不误显示未绑定', async () => {
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error('failed'))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        bound: false,
        providerUsername: null,
        canUnbind: false,
      }),
    });
  render(<LinuxDoBindingTile />);
  fireEvent.click(await screen.findByRole('button', { name: '重试' }));
  expect(await screen.findByText('未绑定')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
