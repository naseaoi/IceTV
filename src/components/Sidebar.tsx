'use client';

import {
  Cat,
  Clover,
  Film,
  Home,
  Menu,
  Radio,
  Search,
  Star,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import { useIntentPrefetch } from '@/hooks/useIntentPrefetch';
import {
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from '@/lib/local-preferences';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { getCustomCategoryLabel, RuntimeConfig } from '@/lib/runtime-config';

import { useRuntimeConfig } from './RuntimeConfigProvider';
import {
  getSidebarItemLabelClass,
  SIDEBAR_BUTTON_STATE_CLASS,
  SIDEBAR_ITEM_ICON_CLASS,
  SIDEBAR_ITEM_ICON_WRAP_CLASS,
  SIDEBAR_ITEM_LAYOUT_CLASS,
  SIDEBAR_LINK_ICON_CLASS,
  SIDEBAR_LINK_STATE_CLASS,
} from './SidebarItem';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface SidebarContextType {
  isCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
});

export const SiteIcon = () => {
  const { siteIcon, siteName } = useSite();
  const fallbackIcon = '/icons/icon-192x192.png';
  const iconSrc = siteIcon || fallbackIcon;

  return (
    <img
      src={iconSrc}
      alt={siteName}
      className='h-full w-full object-contain'
      onError={(e) => {
        const img = e.target as HTMLImageElement;
        if (img.src !== window.location.origin + fallbackIcon) {
          img.src = fallbackIcon;
        }
      }}
    />
  );
};

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

type SidebarMenuItem = {
  icon: typeof Film;
  label: string;
  href: string;
};

const LIVE_ROUTE = '/live';

function shouldPrefetchRoute(href: string): boolean {
  return href !== LIVE_ROUTE;
}

function getSidebarMenuItems(runtimeConfig?: RuntimeConfig): SidebarMenuItem[] {
  const nextItems: SidebarMenuItem[] = [
    {
      icon: Film,
      label: '电影',
      href: '/douban?type=movie',
    },
    {
      icon: Tv,
      label: '剧集',
      href: '/douban?type=tv',
    },
    {
      icon: Cat,
      label: '动漫',
      href: '/douban?type=anime',
    },
    {
      icon: Clover,
      label: '综艺',
      href: '/douban?type=show',
    },
  ];

  if (runtimeConfig?.ENABLE_LIVE_ENTRY) {
    nextItems.push({
      icon: Radio,
      label: '直播',
      href: LIVE_ROUTE,
    });
  }

  if ((runtimeConfig?.CUSTOM_CATEGORIES?.length ?? 0) > 0) {
    nextItems.push({
      icon: Star,
      label: getCustomCategoryLabel(runtimeConfig),
      href: '/douban?type=custom',
    });
  }

  return nextItems;
}

declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
  }
}

const getInitialSidebarCollapsed = (): boolean => {
  return false;
};

const Sidebar = ({ onToggle, activePath = '/' }: SidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const runtimeConfig = useRuntimeConfig();
  const { siteName } = useSite();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    getInitialSidebarCollapsed,
  );
  const prefetchIntent = useIntentPrefetch();

  useLayoutEffect(() => {
    const collapsed =
      typeof window.__sidebarCollapsed === 'boolean'
        ? window.__sidebarCollapsed
        : readSidebarCollapsed();
    setIsCollapsed(collapsed);
    onToggle?.(collapsed);
  }, [onToggle]);

  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      if (isCollapsed) {
        document.documentElement.dataset.sidebarCollapsed = 'true';
      } else {
        delete document.documentElement.dataset.sidebarCollapsed;
      }
    }
  }, [isCollapsed]);

  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      document.querySelector('[data-sidebar]')?.setAttribute('data-ready', '');
      document
        .querySelector('[data-sidebar-offset]')
        ?.setAttribute('data-ready', '');
    });
  }, []);

  const [active, setActive] = useState(activePath);

  useEffect(() => {
    if (activePath) {
      setActive(activePath);
    } else {
      const queryString = window.location.search;
      const fullPath = queryString ? `${pathname}${queryString}` : pathname;
      setActive(fullPath);
    }
  }, [activePath, pathname]);

  const handleToggle = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    writeSidebarCollapsed(newState);
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = newState;
    }
    onToggle?.(newState);
  }, [isCollapsed, onToggle]);

  const handleMenuItemClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (
        href !== LIVE_ROUTE ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const returnTo = getCurrentNavigationPath();
      if (returnTo.startsWith(LIVE_ROUTE)) {
        return;
      }

      event.preventDefault();
      router.push(withReturnTo(href, returnTo));
    },
    [router],
  );

  const prefetchRoute = useCallback(
    (href: string) => {
      if (!shouldPrefetchRoute(href)) {
        return;
      }
      prefetchIntent(href);
    },
    [prefetchIntent],
  );

  const contextValue = {
    isCollapsed,
  };

  const menuItems = useMemo(
    () => getSidebarMenuItems(runtimeConfig),
    [runtimeConfig],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div className='hidden md:flex'>
        <aside
          data-sidebar
          className={`fixed left-0 top-0 z-10 h-screen border-r border-gray-200/50 bg-white/40 shadow-lg backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] dark:border-gray-700/50 dark:bg-gray-900/70 ${
            isCollapsed ? 'w-20' : 'w-60'
          }`}
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className='flex h-full flex-col'>
            <div className='flex items-center px-2 pb-5 pt-6'>
              <Link
                href='/'
                data-brand-link
                className={`flex min-h-[52px] w-full select-none items-center justify-start overflow-hidden rounded-xl py-2.5 transition-[padding,gap] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-90 ${
                  isCollapsed ? 'gap-0 px-1' : 'gap-3.5 px-2'
                }`}
              >
                <div className='flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-gray-50 p-1.5 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/50'>
                  <SiteIcon />
                </div>
                <span
                  data-sidebar-label
                  className={`overflow-hidden whitespace-nowrap text-xl font-bold tracking-tight text-gray-800 transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] dark:text-gray-100 ${
                    isCollapsed
                      ? 'max-w-0 opacity-0'
                      : 'max-w-[135px] opacity-100'
                  }`}
                >
                  {siteName}
                </span>
              </Link>
            </div>
            <div className='mx-3 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent dark:via-gray-700' />

            <nav className='mt-5 space-y-1.5 px-3'>
              <Link
                href='/'
                prefetch={false}
                onMouseEnter={() => prefetchRoute('/')}
                onFocus={() => prefetchRoute('/')}
                onTouchStart={() => prefetchRoute('/')}
                data-active={active === '/'}
                className={`${SIDEBAR_ITEM_LAYOUT_CLASS} font-medium ${SIDEBAR_LINK_STATE_CLASS} ${
                  isCollapsed ? 'mx-0 w-full max-w-none' : 'mx-0'
                }`}
              >
                <div className={SIDEBAR_ITEM_ICON_WRAP_CLASS}>
                  <Home className={SIDEBAR_LINK_ICON_CLASS} />
                </div>
                <span
                  data-sidebar-label
                  className={getSidebarItemLabelClass(isCollapsed)}
                >
                  首页
                </span>
              </Link>
              <Link
                href='/search'
                prefetch={false}
                onMouseEnter={() => prefetchRoute('/search')}
                onFocus={() => prefetchRoute('/search')}
                onTouchStart={() => prefetchRoute('/search')}
                data-active={active === '/search'}
                className={`${SIDEBAR_ITEM_LAYOUT_CLASS} font-medium ${SIDEBAR_LINK_STATE_CLASS} ${
                  isCollapsed ? 'mx-0 w-full max-w-none' : 'mx-0'
                }`}
              >
                <div className={SIDEBAR_ITEM_ICON_WRAP_CLASS}>
                  <Search className={SIDEBAR_LINK_ICON_CLASS} />
                </div>
                <span
                  data-sidebar-label
                  className={getSidebarItemLabelClass(isCollapsed)}
                >
                  搜索
                </span>
              </Link>
            </nav>

            <div className='flex-1 overflow-y-auto px-3 pt-5'>
              <div className='space-y-1.5'>
                {menuItems.map((item) => {
                  const typeMatch = item.href.match(/type=([^&]+)/)?.[1];

                  const decodedActive = decodeURIComponent(active);
                  const decodedItemHref = decodeURIComponent(item.href);

                  const isActive =
                    decodedActive === decodedItemHref ||
                    (decodedActive.startsWith('/douban') &&
                      decodedActive.includes(`type=${typeMatch}`));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      prefetch={false}
                      onMouseEnter={() => prefetchRoute(item.href)}
                      onFocus={() => prefetchRoute(item.href)}
                      onTouchStart={() => prefetchRoute(item.href)}
                      onClick={(event) => handleMenuItemClick(event, item.href)}
                      data-active={isActive}
                      className={`${SIDEBAR_ITEM_LAYOUT_CLASS} ${SIDEBAR_LINK_STATE_CLASS} ${
                        isCollapsed ? 'mx-0 w-full max-w-none' : 'mx-0'
                      }`}
                    >
                      <div className={SIDEBAR_ITEM_ICON_WRAP_CLASS}>
                        <Icon className={SIDEBAR_LINK_ICON_CLASS} />
                      </div>
                      <span
                        data-sidebar-label
                        className={getSidebarItemLabelClass(isCollapsed)}
                      >
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className='px-3 pb-4 pt-2'>
              <div className='mx-1 mb-2 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent dark:via-gray-700' />
              <div className='space-y-1.5'>
                <UserMenu variant='sidebar' isCollapsed={isCollapsed} />
                <ThemeToggle variant='sidebar' isCollapsed={isCollapsed} />
                <button
                  onClick={handleToggle}
                  className={`${SIDEBAR_ITEM_LAYOUT_CLASS} w-full ${SIDEBAR_BUTTON_STATE_CLASS}`}
                  title={isCollapsed ? '展开侧栏' : '折叠侧栏'}
                >
                  <div className={SIDEBAR_ITEM_ICON_WRAP_CLASS}>
                    <Menu className={SIDEBAR_ITEM_ICON_CLASS} />
                  </div>
                  <span
                    data-sidebar-label
                    className={getSidebarItemLabelClass(isCollapsed)}
                  >
                    折叠
                  </span>
                </button>
              </div>
            </div>
          </div>
        </aside>
        <div
          data-sidebar-offset
          className={`sidebar-offset transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
            isCollapsed ? 'w-20' : 'w-60'
          }`}
        ></div>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
