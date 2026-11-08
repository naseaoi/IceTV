'use client';

import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import { VersionPanel } from '@/components/user-menu/lazy-panels';
import {
  readNotifiedReleaseVersion,
  writeNotifiedReleaseVersion,
} from '@/lib/local-preferences';
import { showToast } from '@/lib/toast';
import { checkLatestRelease, UpdateStatus } from '@/lib/version-check';

export const RELEASE_TOAST_KEY = 'release';
const RELEASE_TOAST_DURATION_MS = 10_000;
// 避开首屏加载高峰，也让消息提醒先出现
const RELEASE_CHECK_DELAY_MS = 4_000;

// 只有站长能部署新版本，其他角色仍通过头像红点感知更新
export default function ReleaseNotifier() {
  const { session } = useAuthSession();
  const isOwner =
    session.status === 'authenticated' && session.role === 'owner';
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkLatestRelease().then(({ status, latestVersion }) => {
        if (cancelled || status !== UpdateStatus.HAS_UPDATE || !latestVersion) {
          return;
        }
        if (readNotifiedReleaseVersion() === latestVersion) return;
        writeNotifiedReleaseVersion(latestVersion);
        showToast(
          `IceTV v${latestVersion.replace(/^v/i, '')} 已发布`,
          'notice',
          {
            key: RELEASE_TOAST_KEY,
            duration: RELEASE_TOAST_DURATION_MS,
            action: { label: '查看', onClick: () => setPanelOpen(true) },
          },
        );
      });
    }, RELEASE_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOwner]);

  return panelOpen ? (
    <VersionPanel isOpen onClose={() => setPanelOpen(false)} />
  ) : null;
}
