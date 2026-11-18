'use client';

import dynamic from 'next/dynamic';

export const SettingsPanel = dynamic<{ onClose: () => void }>(
  () =>
    import('@/components/user-menu/SettingsPanel').then(
      (mod) => mod.SettingsPanel,
    ),
  { ssr: false },
);

export const ChangePasswordPanel = dynamic<{
  onClose: () => void;
  onLogout: () => Promise<void>;
}>(
  () =>
    import('@/components/user-menu/ChangePasswordPanel').then(
      (mod) => mod.ChangePasswordPanel,
    ),
  { ssr: false },
);

export const VersionPanel = dynamic<{ isOpen: boolean; onClose: () => void }>(
  () => import('@/components/VersionPanel').then((mod) => mod.VersionPanel),
  { ssr: false },
);

export const WatchLevelPanel = dynamic<{ onClose: () => void }>(
  () =>
    import('@/features/watch-level/WatchLevelPanel').then(
      (mod) => mod.WatchLevelPanel,
    ),
  { ssr: false },
);
