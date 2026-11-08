'use client';

import {
  ChevronRight,
  CircleUserRound,
  Heart,
  History,
  LogIn,
  LogOut,
  MessageSquareText,
  Settings,
  Shield,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { usePresence } from '@/hooks/usePresence';
import { snapToDevicePixel } from '@/lib/pixel-snap';
import { getClientAuthRuntimeConfig } from '@/lib/runtime-config';
import { CURRENT_VERSION } from '@/lib/version';

import { useAuthSession } from './AuthProvider';
import ProfileAvatar from './ProfileAvatar';
import {
  buildLoginHref,
  logout,
  ROLE_TEXT,
  useHasUpdate,
} from './user-menu/account';
import {
  ChangePasswordPanel,
  SettingsPanel,
  VersionPanel,
} from './user-menu/lazy-panels';
import { ProfilePanel } from './user-menu/ProfilePanel';
import { UserAvatar } from './user-menu/UserAvatar';

const MENU_DIVIDER_CLASS =
  'mx-1.5 my-1 h-px bg-gray-200/70 dark:bg-white/[0.06]';

const MENU_ROW_CLASS =
  'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.06] dark:hover:text-white';

const MENU_ICON_CLASS = 'h-4 w-4 text-gray-400 dark:text-gray-500';

const MENU_EXIT_MS = 200;

const QUICK_LINKS = [
  { icon: Heart, label: '收藏', href: '/me/favorites' },
  { icon: History, label: '历史', href: '/me/history' },
  { icon: MessageSquareText, label: '评价', href: '/me/reviews' },
];

export const UserMenu: React.FC = () => {
  const router = useRouter();
  const { session } = useAuthSession();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPlacement, setMenuPlacement] = useState<'up' | 'down'>('down');
  const [menuPos, setMenuPos] = useState<CSSProperties>({});
  const [isOpen, setIsOpen] = useState(false);
  const menuPresence = usePresence(isOpen, MENU_EXIT_MS);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isVersionPanelOpen, setIsVersionPanelOpen] = useState(false);
  const [storageType, setStorageType] = useState<string>('localdb');
  const [mounted, setMounted] = useState(false);
  const hasUpdate = useHasUpdate();

  useEffect(() => {
    let cancelled = false;

    setMounted(true);

    const loadClientState = async () => {
      const { storageType } = await getClientAuthRuntimeConfig();
      if (cancelled) {
        return;
      }

      setStorageType(storageType);
    };

    loadClientState();

    return () => {
      cancelled = true;
    };
  }, []);

  const computeMenuPos = useMemo(() => {
    const VIEWPORT_GAP_PX = 8;
    const ANCHOR_GAP_PX = 8;
    const MIN_PANEL_HEIGHT_GUESS_PX = 280;

    return (rect: DOMRect) => {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const shouldOpenUp =
        spaceBelow < MIN_PANEL_HEIGHT_GUESS_PX && spaceAbove > spaceBelow;

      setMenuPlacement(shouldOpenUp ? 'up' : 'down');

      const right = snapToDevicePixel(
        Math.max(window.innerWidth - rect.right, VIEWPORT_GAP_PX),
      );
      if (shouldOpenUp) {
        return {
          bottom: snapToDevicePixel(
            Math.max(window.innerHeight - rect.top + ANCHOR_GAP_PX, 0),
          ),
          right,
        };
      }
      return {
        top: snapToDevicePixel(rect.bottom + ANCHOR_GAP_PX),
        right,
      };
    };
  }, []);

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
    router.push(buildLoginHref());
  };

  const handleLogout = logout;

  const navigateTo = (href: string) => {
    setIsOpen(false);
    router.push(href);
  };

  const handleSettings = () => {
    setIsOpen(false);
    setIsSettingsOpen(true);
  };

  const handleVersionPanel = () => {
    setIsOpen(false);
    setIsVersionPanelOpen(true);
  };

  const isAuthenticated = session.status === 'authenticated';
  const renderAvatar = (className: string) =>
    session.status === 'authenticated' ? (
      <ProfileAvatar user={session} className={className} />
    ) : null;
  const role = isAuthenticated ? session.role : 'user';
  const showAdminPanel =
    isAuthenticated && (role === 'owner' || role === 'admin');
  const showChangePassword = isAuthenticated && role !== 'owner';

  const handleProfile = () => {
    setIsOpen(false);
    setIsProfileOpen(true);
  };

  const tileActions = [
    ...QUICK_LINKS.map(({ icon, label, href }) => ({
      icon,
      label,
      onClick: () => navigateTo(href),
    })),
    { icon: CircleUserRound, label: '资料', onClick: handleProfile },
    { icon: Settings, label: '设置', onClick: handleSettings },
    ...(showAdminPanel
      ? [{ icon: Shield, label: '后台', onClick: () => navigateTo('/admin') }]
      : []),
  ];

  const displayName = isAuthenticated
    ? (session.nickname ?? session.username)
    : '';

  const menuPanel = (
    <>
      {isOpen && (
        <div
          className='fixed inset-0 z-[1000] bg-transparent'
          onClick={handleCloseMenu}
        />
      )}

      <div
        role='menu'
        aria-label='账户菜单'
        data-open={menuPresence.visible}
        className='motion-popover fixed z-[1001] w-64 max-w-[calc(100vw-16px)] select-none overflow-hidden rounded-2xl bg-white p-1.5 shadow-2xl shadow-black/10 ring-1 ring-gray-900/[0.08] dark:bg-gray-900 dark:shadow-black/50 dark:ring-white/[0.08]'
        style={
          {
            ...menuPos,
            '--popover-origin':
              menuPlacement === 'up' ? 'bottom right' : 'top right',
            '--popover-shift': menuPlacement === 'up' ? '6px' : '-6px',
          } as CSSProperties
        }
      >
        {isAuthenticated ? (
          <>
            <button
              type='button'
              onClick={() => navigateTo('/me')}
              className='group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-gray-900/[0.05] dark:hover:bg-white/[0.06]'
            >
              {renderAvatar('h-10 w-10')}
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
                  {displayName}
                </div>
                <div className='mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400'>
                  {ROLE_TEXT[role]}
                </div>
              </div>
              <ChevronRight className='h-4 w-4 flex-shrink-0 text-gray-300 transition-transform duration-200 group-hover:translate-x-0.5 dark:text-gray-600' />
            </button>

            {/* 不足一行的宫格居中 */}
            <div className='motion-stagger mt-1 flex flex-wrap justify-center gap-y-1'>
              {tileActions.map(({ icon: Icon, label, onClick }, index) => (
                <button
                  key={label}
                  type='button'
                  role='menuitem'
                  onClick={onClick}
                  style={{ '--stagger-index': index } as CSSProperties}
                  className='flex w-1/3 flex-col items-center gap-1.5 rounded-xl py-2.5 text-xs text-gray-600 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
                >
                  <Icon className='h-[18px] w-[18px]' strokeWidth={1.75} />
                  {label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className='flex items-center gap-3 px-2.5 py-2.5'>
              <UserAvatar size='lg' />
              <div className='min-w-0 flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100'>
                未登录
              </div>
              <button
                type='button'
                onClick={handleLogin}
                className='inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-500'
              >
                <LogIn className='h-3.5 w-3.5' />
                登录
              </button>
            </div>
            <div className={MENU_DIVIDER_CLASS} />
            <button
              type='button'
              role='menuitem'
              onClick={handleSettings}
              className={MENU_ROW_CLASS}
            >
              <Settings className={MENU_ICON_CLASS} />
              <span>本地设置</span>
            </button>
          </>
        )}

        <div className={MENU_DIVIDER_CLASS} />

        <div className='flex items-center justify-between gap-2'>
          <button
            type='button'
            onClick={handleVersionPanel}
            title={hasUpdate ? '有新版本' : undefined}
            className='flex min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-400 transition-colors hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300'
          >
            <span className={`relative min-w-0 ${hasUpdate ? 'pr-2' : ''}`}>
              <span className='block truncate font-mono'>
                v{CURRENT_VERSION}
              </span>
              {hasUpdate && (
                <>
                  <span className='absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-brand-500' />
                  <span className='sr-only'>，有新版本</span>
                </>
              )}
            </span>
            <span aria-hidden='true'>·</span>
            <span className='shrink-0'>{storageType}</span>
          </button>
          {isAuthenticated && (
            <button
              type='button'
              role='menuitem'
              onClick={handleLogout}
              className='inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-900/[0.05] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
            >
              <LogOut className='h-3.5 w-3.5' />
              退出
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className='relative'>
        <button
          ref={buttonRef}
          onClick={handleMenuClick}
          className='flex h-10 w-10 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-900/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.06]'
          aria-label={isAuthenticated ? '账户菜单' : '登录'}
        >
          {isAuthenticated ? (
            renderAvatar('h-7 w-7')
          ) : (
            <CircleUserRound className='h-6 w-6' />
          )}
        </button>
        {hasUpdate && (
          <span className='pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-gray-50 dark:ring-gray-950' />
        )}
      </div>

      {menuPresence.mounted &&
        mounted &&
        createPortal(menuPanel, document.body)}

      {isSettingsOpen && (
        <SettingsPanel onClose={() => setIsSettingsOpen(false)} />
      )}

      {isChangePasswordOpen && (
        <ChangePasswordPanel
          onClose={() => setIsChangePasswordOpen(false)}
          onLogout={handleLogout}
        />
      )}

      {isProfileOpen && (
        <ProfilePanel
          onClose={() => setIsProfileOpen(false)}
          onChangePassword={
            showChangePassword
              ? () => {
                  setIsProfileOpen(false);
                  setIsChangePasswordOpen(true);
                }
              : undefined
          }
        />
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
