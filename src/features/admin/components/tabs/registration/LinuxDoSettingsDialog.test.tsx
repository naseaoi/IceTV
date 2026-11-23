import { act, fireEvent, render, screen } from '@testing-library/react';

import { LinuxDoSettingsDialog } from '@/features/admin/components/tabs/registration/LinuxDoSettingsDialog';
import { DisplayableError } from '@/lib/user-facing-error';
import type { LinuxDoLoginSettings } from '@/types/admin';

jest.mock('@/lib/clipboard', () => ({ copyTextToClipboard: jest.fn() }));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

const UNSAVED: LinuxDoLoginSettings = {
  Enabled: false,
  MinTrustLevel: 1,
  ClientId: '',
  ClientSecret: '',
  RedirectUri: '',
};

function renderDialog(
  onSave: jest.Mock,
  configured = false,
  settings: LinuxDoLoginSettings = UNSAVED,
) {
  const onClose = jest.fn();
  render(
    <LinuxDoSettingsDialog
      isOpen
      configured={configured}
      settings={settings}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onClose };
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
  });
}

it('requires a secret before the first save and submits the trimmed draft', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const { onClose } = renderDialog(onSave);

  fireEvent.change(screen.getByLabelText('Client ID'), {
    target: { value: ' my-client ' },
  });
  await submit();
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('请填写 Client Secret');

  fireEvent.change(screen.getByLabelText('Client Secret'), {
    target: { value: 'secret' },
  });
  await submit();
  expect(onSave).toHaveBeenCalledWith({
    credentials: {
      clientId: 'my-client',
      clientSecret: 'secret',
      redirectUri: `${window.location.origin}/api/auth/linuxdo/callback`,
    },
    minTrustLevel: 1,
  });
  expect(onClose).toHaveBeenCalled();
});

it('keeps the saved secret when it is left blank', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  renderDialog(onSave, true, {
    ...UNSAVED,
    ClientId: 'saved-client',
    RedirectUri: 'https://tv.example/api/auth/linuxdo/callback',
  });

  expect(screen.getByLabelText('Client ID')).toHaveValue('saved-client');
  expect(screen.getByLabelText('Client Secret')).toHaveValue('');
  await submit();
  expect(onSave).toHaveBeenCalledWith({
    credentials: {
      clientId: 'saved-client',
      clientSecret: '',
      redirectUri: 'https://tv.example/api/auth/linuxdo/callback',
    },
    minTrustLevel: 1,
  });
});

it('shows save failures inside the form and stays open', async () => {
  const onSave = jest
    .fn()
    .mockRejectedValue(
      new DisplayableError('回调地址需为本站的 /api/auth/linuxdo/callback'),
    );
  const { onClose } = renderDialog(onSave, true, {
    ...UNSAVED,
    ClientId: 'saved-client',
  });
  await submit();
  expect(screen.getByRole('alert')).toHaveTextContent('回调地址需为本站');
  expect(onClose).not.toHaveBeenCalled();
});
