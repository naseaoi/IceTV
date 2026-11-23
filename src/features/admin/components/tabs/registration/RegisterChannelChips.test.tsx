import { fireEvent, render, screen, within } from '@testing-library/react';

import { RegisterChannelChips } from '@/features/admin/components/tabs/registration/RegisterChannelChips';
import type { RegisterChannels } from '@/types/admin';

function renderChips(channels: RegisterChannels, linuxDoActive = true) {
  const onChange = jest.fn();
  render(
    <RegisterChannelChips
      channels={channels}
      linuxDoActive={linuxDoActive}
      busy={false}
      onChange={onChange}
    />,
  );
  const group = screen.getByRole('group', { name: '注册通道' });
  return {
    onChange,
    password: within(group).getByRole('button', { name: /账号/ }),
    linuxDo: within(group).getByRole('button', { name: /LinuxDo/ }),
  };
}

it('toggles a channel while keeping at least one enabled', () => {
  const { onChange, password, linuxDo } = renderChips({
    Password: true,
    LinuxDo: false,
  });
  expect(password).toHaveAttribute('aria-pressed', 'true');
  expect(password).toBeDisabled();

  fireEvent.click(linuxDo);
  expect(onChange).toHaveBeenCalledWith({ Password: true, LinuxDo: true });
});

it('blocks enabling the LinuxDo channel before LinuxDo login is active', () => {
  const { linuxDo } = renderChips({ Password: true, LinuxDo: false }, false);
  expect(linuxDo).toBeDisabled();
});

it('lets an inactive LinuxDo channel be turned off', () => {
  const { onChange, linuxDo } = renderChips(
    { Password: true, LinuxDo: true },
    false,
  );
  expect(linuxDo).toBeEnabled();
  fireEvent.click(linuxDo);
  expect(onChange).toHaveBeenCalledWith({ Password: true, LinuxDo: false });
});
