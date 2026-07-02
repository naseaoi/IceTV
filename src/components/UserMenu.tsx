'use client';

import {
  GitBranch,
  KeyRound,
  LogIn,
  LogOut,
  Settings,
  Shield,
  User,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  SIDEBAR_BUTTON_STATE_CLASS,
  SIDEBAR_ITEM_ICON_CLASS,
  SIDEBAR_ITEM_ICON_WRAP_CLASS,
  SIDEBAR_ITEM_LAYOUT_CLASS,
  getSidebarItemLabelClass,
} from './SidebarItem';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { getClientAuthRuntimeConfig } from '@/lib/runtime-config';
import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version-check';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

interface UserMenuProps {
  variant?: 'icon' | 'sidebar';
  isCollapsed?: boolean;
}

interface SettingsPanelProps {
  onClose: () => void;
}

interface ChangePasswordPanelProps {
  onClose: () => void;
  onLogout: () => Promise<void>;
}

interface VersionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsPanel = dynamic<SettingsPanelProps>(
  () => import('./user-menu/SettingsPanel.js').then((mod) => mod.SettingsPanel),
  { ssr: false },
);

const ChangePasswordPanel = dynamic<ChangePasswordPanelProps>(
  () =>
    import('./user-menu/ChangePasswordPanel.js').then(
      (mod) => mod.ChangePasswordPanel,
    ),
  { ssr: false },
);

const VersionPanel = dynamic<VersionPanelProps>(
  () => import('./VersionPanel.js').then((mod) => mod.VersionPanel),
  { ssr: false },
);

export const UserMenu: React.FC<UserMenuProps> = ({
  variant = 'icon',
  isCollapsed = false,
}) => {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPlacement, setMenuPlacement] = useState<'up' | 'down'>('down');
  const [menuPos, setMenuPos] = useState<CSSProperties>({});
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [storageType, setStorageType] = useState<string>('localdb');
  const [mounted, setMounted] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setMounted(true);

    const loadClientState = async () => {
      const auth = getAuthInfoFromBrowserCookie();
      const { storageType } = await getClientAuthRuntimeConfig();
      if (cancelled) {
        return;
      }

      setAuthInfo(auth);
      setStorageType(storageType);
    };

    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (error) {
        console.warn('版本检查失败:', error);
      } finally {
        setIsChecking(false);
      }
    };

    loadClientState();
    checkUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  const computeMenuPos = useMemo(() => {
    const PANEL_WIDTH_PX = 224;
    const VIEWPORT_GAP_PX = 8;
    const ANCHOR_GAP_PX = 8;
    const SIDEBAR_PANEL_GAP_PX = 10;
    const MIN_PANEL_HEIGHT_GUESS_PX = 280;

    const clamp = (value: number, min: number, max: number) =>
      Math.max(min, Math.min(value, max));

    return (rect: DOMRect) => {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const preferUp = variant === 'sidebar';
      const shouldOpenUp =
        preferUp ||
        (spaceBelow < MIN_PANEL_HEIGHT_GUESS_PX && spaceAbove > spaceBelow);

      setMenuPlacement(shouldOpenUp ? 'up' : 'down');

      if (variant === 'icon') {
        const right = Math.max(window.innerWidth - rect.right, VIEWPORT_GAP_PX);
        if (shouldOpenUp) {
          return {
            bottom: Math.max(window.innerHeight - rect.top + ANCHOR_GAP_PX, 0),
            right,
          };
        }
        return {
          top: rect.bottom + ANCHOR_GAP_PX,
          right,
        };
      }

      const sidebarRect = buttonRef.current
        ?.closest<HTMLElement>('[data-sidebar]')
        ?.getBoundingClientRect();
      const left = clamp(
        (sidebarRect?.right ?? rect.right) + SIDEBAR_PANEL_GAP_PX,
        VIEWPORT_GAP_PX,
        window.innerWidth - PANEL_WIDTH_PX - VIEWPORT_GAP_PX,
      );
      if (shouldOpenUp) {
        return {
          bottom: Math.max(window.innerHeight - rect.top + ANCHOR_GAP_PX, 0),
          left,
        };
      }
      return {
        top: rect.bottom + ANCHOR_GAP_PX,
        left,
      };
    };
  }, [variant]);

  const handleMenuClick = () => {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos(computeMenuPos(rect));
    }
    setIsOpen(!isOpen);
  };

  const handleCloseMenu = () => {
    setIsOpen(false);
  };

  const handleLogin = () => {
    const redirect =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}`
        : '/';
    router.push(`/login?redirect=${encodeURIComponent(redirect)}`);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('注销请求失败:', error);
    }
    window.location.href = '/';
  };

  const handleAdminPanel = () => {
    router.push('/admin');
  };

  const handleChangePassword = () => {
    setIsOpen(false);
    setIsChangePasswordOpen(true);
  };

  const handleSettings = () => {
    setIsOpen(false);
    setIsSettingsOpen(true);
  };

  const showAdminPanel =
    authInfo?.role === 'owner' || authInfo?.role === 'admin';
  const isAuthenticated = Boolean(authInfo?.username);
  const showChangePassword = isAuthenticated && authInfo?.role !== 'owner';

  const getRoleText = (role?: string) => {
    switch (role) {
      case 'owner':
        return '站长';
      case 'admin':
        return '管理员';
      case 'user':
        return '用户';
      default:
        return '';
    }
  };

  const menuActions = [
    { icon: Settings, label: '设置', onClick: handleSettings, show: true },
    {
      icon: Shield,
      label: '管理',
      onClick: handleAdminPanel,
      show: showAdminPanel,
    },
    {
      icon: KeyRound,
      label: '密码',
      onClick: handleChangePassword,
      show: showChangePassword,
    },
    {
      icon: GitBranch,
      label: `v${CURRENT_VERSION}`,
      onClick: () => {
        setIsVersionPanelOpen(true);
        handleCloseMenu();
      },
      show: true,
      version: true,
    },
    {
      icon: isAuthenticated ? LogOut : LogIn,
      label: isAuthenticated ? '登出' : '登录',
      onClick: isAuthenticated ? handleLogout : handleLogin,
      show: true,
      danger: isAuthenticated,
    },
  ].filter((action) => action.show);

  const menuPanel = (
    <>
      <div
        className='fixed inset-0 z-[1000] bg-transparent'
        onClick={handleCloseMenu}
      />

      <div
        className={`fixed z-[1001] w-56 max-w-[calc(100vw-16px)] select-none overflow-hidden rounded-2xl border border-gray-200/70 bg-white/80 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-gray-900/70 dark:ring-white/10 ${
          menuPlacement === 'up' ? 'origin-bottom' : 'origin-top'
        }`}
        style={menuPos}
      >
        <div className='relative px-4 pb-3 pt-4'>
          <div className='absolute inset-x-0 top-0 h-14 bg-gradient-to-br from-emerald-500/10 via-green-400/5 to-transparent dark:from-emerald-500/15 dark:via-green-500/5' />

          <button
            onClick={handleCloseMenu}
            className='absolute right-2 top-2 z-10 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100/70 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200'
            aria-label='关闭菜单'
          >
            <X className='h-4 w-4' />
          </button>

          <div className='relative flex flex-col items-center text-center'>
            <div className='flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-200 to-green-100 text-emerald-700 shadow-lg ring-2 ring-white/80 dark:from-emerald-500/20 dark:to-green-500/15 dark:text-emerald-200 dark:ring-white/10'>
              <User className='h-6 w-6' />
            </div>
            <div className='mt-2.5 max-w-full truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
              {authInfo?.username || '未登录'}
            </div>
            <div className='mt-1 flex items-center gap-2'>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  !isAuthenticated
                    ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    : (authInfo?.role || 'user') === 'owner'
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200'
                      : (authInfo?.role || 'user') === 'admin'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
                        : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200'
                }`}
              >
                {isAuthenticated
                  ? getRoleText(authInfo?.role || 'user')
                  : '游客'}
              </span>
              <span className='text-[10px] text-gray-400 dark:text-gray-500'>
                {storageType}
              </span>
            </div>
          </div>
        </div>

        <div className='mx-3 h-px bg-gradient-to-r from-transparent via-gray-200/80 to-transparent dark:via-white/[0.10]' />

        <div className='grid grid-cols-2 gap-1.5 px-2.5 py-2'>
          {menuActions.map(
            ({ icon: Icon, label, onClick, danger, version }) => (
              <button
                key={label}
                onClick={onClick}
                className={`relative flex flex-col items-center gap-2 rounded-xl px-1 py-3 transition-colors ${
                  danger
                    ? 'text-rose-600 hover:bg-rose-50/70 dark:text-rose-300 dark:hover:bg-rose-500/10'
                    : 'text-gray-600 hover:bg-gray-100/70 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                }`}
              >
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                    danger
                      ? 'bg-rose-50/80 dark:bg-rose-500/10'
                      : 'bg-gray-100/80 dark:bg-white/[0.06]'
                  }`}
                >
                  <Icon className='h-[22px] w-[22px]' />
                </div>
                <span
                  className={`text-sm font-medium ${version ? 'font-mono' : ''}`}
                >
                  {label}
                </span>
                {version &&
                  !isChecking &&
                  updateStatus === UpdateStatus.HAS_UPDATE && (
                    <div className='absolute right-2 top-2 h-2 w-2 rounded-full bg-yellow-500' />
                  )}
              </button>
            ),
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      {variant === 'sidebar' ? (
        <div className='relative w-full'>
          <button
            ref={buttonRef}
            onClick={handleMenuClick}
            className={`${SIDEBAR_ITEM_LAYOUT_CLASS} w-full ${SIDEBAR_BUTTON_STATE_CLASS}`}
            aria-label='User Menu'
            title='用户'
          >
            <div className={`relative ${SIDEBAR_ITEM_ICON_WRAP_CLASS}`}>
              <User className={SIDEBAR_ITEM_ICON_CLASS} />
              {updateStatus === UpdateStatus.HAS_UPDATE && (
                <div className='absolute -right-1 -top-1 h-2 w-2 rounded-full bg-yellow-500'></div>
              )}
            </div>
            <span className={getSidebarItemLabelClass(isCollapsed)}>用户</span>
          </button>
        </div>
      ) : (
        <div className='relative'>
          <button
            ref={buttonRef}
            onClick={handleMenuClick}
            className='flex h-10 w-10 items-center justify-center rounded-full p-2 text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
            aria-label='User Menu'
          >
            <User className='h-full w-full' />
          </button>
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <div className='absolute right-[2px] top-[2px] h-2 w-2 rounded-full bg-yellow-500'></div>
          )}
        </div>
      )}

      {isOpen && mounted && createPortal(menuPanel, document.body)}

      {isSettingsOpen &&
        mounted &&
        createPortal(
          <SettingsPanel onClose={() => setIsSettingsOpen(false)} />,
          document.body,
        )}

      {isChangePasswordOpen &&
        mounted &&
        createPortal(
          <ChangePasswordPanel
            onClose={() => setIsChangePasswordOpen(false)}
            onLogout={handleLogout}
          />,
          document.body,
        )}

      {isVersionPanelOpen && (
        <VersionPanel
          isOpen={isVersionPanelOpen}
          onClose={() => setIsVersionPanelOpen(false)}
        />
      )}
    </>
  );
};
