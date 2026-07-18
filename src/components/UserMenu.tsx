'use client';

import {
  ChevronRight,
  CircleUserRound,
  KeyRound,
  LogIn,
  LogOut,
  Settings,
  Shield,
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

import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import { getClientAuthRuntimeConfig } from '@/lib/runtime-config';
import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version-check';

import {
  getSidebarItemLabelClass,
  SIDEBAR_BUTTON_STATE_CLASS,
  SIDEBAR_ITEM_ICON_CLASS,
  SIDEBAR_ITEM_ICON_WRAP_CLASS,
  SIDEBAR_ITEM_LAYOUT_CLASS,
} from './SidebarItem';
import { UserAvatar } from './user-menu/UserAvatar';

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
  () =>
    import('@/components/user-menu/SettingsPanel').then(
      (mod) => mod.SettingsPanel,
    ),
  { ssr: false },
);

const ChangePasswordPanel = dynamic<ChangePasswordPanelProps>(
  () =>
    import('@/components/user-menu/ChangePasswordPanel').then(
      (mod) => mod.ChangePasswordPanel,
    ),
  { ssr: false },
);

const VersionPanel = dynamic<VersionPanelProps>(
  () => import('@/components/VersionPanel').then((mod) => mod.VersionPanel),
  { ssr: false },
);

const ROLE_TEXT: Record<string, string> = {
  owner: '站长',
  admin: '管理员',
  user: '用户',
};

const ROLE_BADGE_CLASS: Record<string, string> = {
  owner:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200',
  admin:
    'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200',
  user: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
};

const MENU_DIVIDER_CLASS = 'h-px bg-gray-200/70 dark:bg-white/[0.08]';

const MENU_ROW_CLASS =
  'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors';

const MENU_BADGE_CLASS =
  'flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium';

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
    setIsOpen(false);
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

  const handleGoMe = () => {
    setIsOpen(false);
    router.push('/me');
  };

  const handleAdminPanel = () => {
    setIsOpen(false);
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

  const handleVersionPanel = () => {
    setIsOpen(false);
    setIsVersionPanelOpen(true);
  };

  const showAdminPanel =
    authInfo?.role === 'owner' || authInfo?.role === 'admin';
  const isAuthenticated = Boolean(authInfo?.username);
  const showChangePassword = isAuthenticated && authInfo?.role !== 'owner';
  const role = authInfo?.role || 'user';
  const hasUpdate = !isChecking && updateStatus === UpdateStatus.HAS_UPDATE;

  const listActions = [
    { icon: Settings, label: '本地设置', onClick: handleSettings, show: true },
    {
      icon: Shield,
      label: '管理后台',
      onClick: handleAdminPanel,
      show: showAdminPanel,
    },
    {
      icon: KeyRound,
      label: '修改密码',
      onClick: handleChangePassword,
      show: showChangePassword,
    },
  ].filter((action) => action.show);

  const menuPanel = (
    <>
      <div
        className='fixed inset-0 z-[1000] bg-transparent'
        onClick={handleCloseMenu}
      />

      <div
        className={`fixed z-[1001] w-56 max-w-[calc(100vw-16px)] select-none overflow-hidden rounded-2xl border border-gray-200/70 bg-white/85 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl motion-reduce:animate-none dark:border-white/10 dark:bg-gray-900/80 dark:ring-white/10 ${
          menuPlacement === 'up' ? 'animate-menu-in-up' : 'animate-menu-in-down'
        }`}
        style={menuPos}
      >
        {isAuthenticated ? (
          <button
            onClick={handleGoMe}
            className='group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-100/60 dark:hover:bg-white/[0.05]'
          >
            <UserAvatar username={authInfo?.username} role={role} size='lg' />
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-1.5'>
                <span className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
                  {authInfo?.username}
                </span>
                <span
                  className={`${MENU_BADGE_CLASS} ${ROLE_BADGE_CLASS[role]}`}
                >
                  {ROLE_TEXT[role]}
                </span>
              </div>
              <div className='mt-0.5 text-xs text-gray-500 dark:text-gray-400'>
                查看我的主页
              </div>
            </div>
            <ChevronRight className='h-4 w-4 flex-shrink-0 text-gray-400 transition-transform duration-200 group-hover:translate-x-0.5' />
          </button>
        ) : (
          <div className='flex w-full items-center gap-3 px-4 py-3.5'>
            <UserAvatar size='lg' />
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-1.5'>
                <span className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                  游客
                </span>
                <span
                  className={`${MENU_BADGE_CLASS} bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300`}
                >
                  未登录
                </span>
              </div>
              <div className='mt-0.5 text-xs text-gray-500 dark:text-gray-400'>
                登录后可使用收藏与历史
              </div>
            </div>
          </div>
        )}

        <div className={MENU_DIVIDER_CLASS} />

        <div className='px-2 py-1.5'>
          {listActions.map(({ icon: Icon, label, onClick }) => (
            <button
              key={label}
              onClick={onClick}
              className={`${MENU_ROW_CLASS} text-gray-700 hover:bg-gray-100/70 dark:text-gray-200 dark:hover:bg-white/[0.06]`}
            >
              <Icon className='h-4 w-4 text-gray-500 dark:text-gray-400' />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className={MENU_DIVIDER_CLASS} />

        <div className='px-2 py-1.5'>
          {isAuthenticated ? (
            <button
              onClick={handleLogout}
              className={`${MENU_ROW_CLASS} text-rose-600 hover:bg-rose-50/70 dark:text-rose-300 dark:hover:bg-rose-500/10`}
            >
              <LogOut className='h-4 w-4' />
              <span>退出登录</span>
            </button>
          ) : (
            <button
              onClick={handleLogin}
              className={`${MENU_ROW_CLASS} text-gray-700 hover:bg-gray-100/70 dark:text-gray-200 dark:hover:bg-white/[0.06]`}
            >
              <LogIn className='h-4 w-4 text-gray-500 dark:text-gray-400' />
              <span>登录账号</span>
            </button>
          )}
        </div>

        <div className={MENU_DIVIDER_CLASS} />

        <button
          onClick={handleVersionPanel}
          className='flex w-full items-center justify-between px-4 py-2.5 text-[11px] text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
        >
          <span className='relative font-mono'>
            v{CURRENT_VERSION}
            {hasUpdate && (
              <span className='absolute -right-2.5 top-0 h-1.5 w-1.5 rounded-full bg-yellow-500' />
            )}
          </span>
          <span>{storageType}</span>
        </button>
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
            aria-label={isAuthenticated ? '账户' : '登录'}
            title={isAuthenticated ? '账户' : '登录'}
          >
            <div className={`relative ${SIDEBAR_ITEM_ICON_WRAP_CLASS}`}>
              {isAuthenticated ? (
                <UserAvatar
                  username={authInfo?.username}
                  role={role}
                  size='sm'
                />
              ) : (
                <CircleUserRound className={SIDEBAR_ITEM_ICON_CLASS} />
              )}
              {updateStatus === UpdateStatus.HAS_UPDATE && (
                <div className='absolute -right-1 -top-1 h-2 w-2 rounded-full bg-yellow-500'></div>
              )}
            </div>
            <span className={getSidebarItemLabelClass(isCollapsed)}>
              {isAuthenticated ? '账户' : '登录'}
            </span>
          </button>
        </div>
      ) : (
        <div className='relative'>
          <button
            ref={buttonRef}
            onClick={handleMenuClick}
            className='flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-200/50 dark:text-gray-300 dark:hover:bg-gray-700/50'
            aria-label={isAuthenticated ? '账户菜单' : '登录'}
          >
            {isAuthenticated ? (
              <UserAvatar username={authInfo?.username} role={role} size='md' />
            ) : (
              <CircleUserRound className='h-6 w-6' />
            )}
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
