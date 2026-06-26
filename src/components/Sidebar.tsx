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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { useSmartHomeNav } from '@/hooks/useSmartHomeNav';
import { RuntimeConfig } from '@/lib/runtime-config';

interface SidebarContextType {
  isCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
});

export const useSidebar = () => useContext(SidebarContext);

// 站点图标：有自定义则用自定义，否则用默认 favicon
const SiteIcon = () => {
  const { siteIcon, siteName } = useSite();
  const iconSrc = siteIcon || '/favicon.ico';

  return (
    <img
      src={iconSrc}
      alt={siteName}
      className='h-full w-full object-contain'
      onError={(e) => {
        const img = e.target as HTMLImageElement;
        // 自定义图标加载失败时回退到默认 favicon
        if (img.src !== window.location.origin + '/favicon.ico') {
          img.src = '/favicon.ico';
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
      href: '/live',
    });
  }

  if ((runtimeConfig?.CUSTOM_CATEGORIES?.length ?? 0) > 0) {
    nextItems.push({
      icon: Star,
      label: '自定义',
      href: '/douban?type=custom',
    });
  }

  return nextItems;
}

// 在浏览器环境下通过全局变量缓存折叠状态，避免组件重新挂载时出现初始值闪烁
declare global {
  interface Window {
    __sidebarCollapsed?: boolean;
  }
}

const getInitialSidebarCollapsed = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  if (typeof window.__sidebarCollapsed === 'boolean') {
    return window.__sidebarCollapsed;
  }

  const saved = localStorage.getItem('sidebarCollapsed');
  if (saved === null) {
    return false;
  }

  try {
    const parsed = JSON.parse(saved);
    return parsed === true;
  } catch {
    return false;
  }
};

const Sidebar = ({ onToggle, activePath = '/' }: SidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const { siteName } = useSite();
  const goHome = useSmartHomeNav();
  // 若同一次 SPA 会话中已经读取过折叠状态，则直接复用，避免闪烁
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    getInitialSidebarCollapsed,
  );
  const prefetchedRoutesRef = useRef<Set<string>>(new Set());

  // 当折叠状态变化时，同步到 <html> data 属性，供首屏 CSS 使用
  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      if (isCollapsed) {
        document.documentElement.dataset.sidebarCollapsed = 'true';
      } else {
        delete document.documentElement.dataset.sidebarCollapsed;
      }
    }
  }, [isCollapsed]);

  // 首次挂载后启用过渡动画，避免 SSR→客户端折叠状态差异导致闪烁
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
    // 优先使用传入的 activePath
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
    localStorage.setItem('sidebarCollapsed', JSON.stringify(newState));
    if (typeof window !== 'undefined') {
      window.__sidebarCollapsed = newState;
    }
    onToggle?.(newState);
  }, [isCollapsed, onToggle]);

  const prefetchRoute = useCallback(
    (href: string) => {
      if (prefetchedRoutesRef.current.has(href)) {
        return;
      }
      prefetchedRoutesRef.current.add(href);
      router.prefetch(href);
    },
    [router],
  );

  useEffect(() => {
    const routes = [
      '/',
      '/search',
      ...getSidebarMenuItems(window.RUNTIME_CONFIG).map((item) => item.href),
    ];

    const prefetchAll = () => {
      routes.forEach(prefetchRoute);
    };

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(prefetchAll, { timeout: 1500 });
    } else {
      timeoutId = setTimeout(prefetchAll, 800);
    }

    return () => {
      if (
        idleId !== null &&
        typeof window !== 'undefined' &&
        'cancelIdleCallback' in window
      ) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [prefetchRoute]);

  const contextValue = {
    isCollapsed,
  };

  const [menuItems, setMenuItems] = useState<SidebarMenuItem[]>(() =>
    getSidebarMenuItems(
      typeof window === 'undefined' ? undefined : window.RUNTIME_CONFIG,
    ),
  );

  useEffect(() => {
    const updateMenuItems = () => {
      setMenuItems(getSidebarMenuItems(window.RUNTIME_CONFIG));
    };

    updateMenuItems();
    window.addEventListener('runtime-config-updated', updateMenuItems);

    return () => {
      window.removeEventListener('runtime-config-updated', updateMenuItems);
    };
  }, []);

  return (
    <SidebarContext.Provider value={contextValue}>
      {/* 在移动端隐藏侧边栏 */}
      <div className='hidden md:flex'>
        <aside
          data-sidebar
          className={`fixed left-0 top-0 z-10 h-screen border-r border-gray-200/50 bg-white/40 shadow-lg backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] dark:border-gray-700/50 dark:bg-gray-900/70 ${
            isCollapsed ? 'w-16' : 'w-64'
          }`}
          style={{
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <div className='flex h-full flex-col'>
            {/* 顶部品牌区域 - 完全复制菜单项布局结构以保证对齐 */}
            <div className='flex items-center px-2 pb-4 pt-6'>
              <Link
                href='/'
                data-brand-link
                onClick={(e) => {
                  e.preventDefault();
                  goHome();
                }}
                className={`flex min-h-[40px] w-full select-none items-center justify-start overflow-hidden rounded-lg py-2 transition-[padding,gap] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-90 ${
                  isCollapsed ? 'gap-0 px-[2px]' : 'gap-3 px-2'
                }`}
              >
                <div className='flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-gray-50 p-1.5 shadow-sm dark:border-gray-700/50 dark:bg-gray-800/50'>
                  <SiteIcon />
                </div>
                <span
                  data-sidebar-label
                  className={`overflow-hidden whitespace-nowrap text-lg font-bold tracking-tight text-gray-800 transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] dark:text-gray-100 ${
                    isCollapsed
                      ? 'max-w-0 opacity-0'
                      : 'max-w-[140px] opacity-100'
                  }`}
                >
                  {siteName}
                </span>
              </Link>
            </div>
            {/* 分割线 */}
            <div className='mx-3 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent dark:via-gray-700' />

            {/* 首页和搜索导航 */}
            <nav className='mt-4 space-y-1 px-2'>
              <Link
                href='/'
                onClick={(e) => {
                  e.preventDefault();
                  setActive('/');
                  goHome();
                }}
                data-active={active === '/'}
                className={`group flex min-h-[40px] items-center rounded-lg px-2 py-2 pl-4 font-medium text-gray-700 transition-colors duration-200 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                  isCollapsed ? 'mx-0 w-full max-w-none' : 'mx-0'
                } justify-start gap-3`}
              >
                <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                  <Home className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                </div>
                <span
                  data-sidebar-label
                  className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
                    isCollapsed
                      ? 'max-w-0 opacity-0'
                      : 'max-w-[120px] opacity-100'
                  }`}
                >
                  首页
                </span>
              </Link>
              <Link
                href='/search'
                onClick={(e) => {
                  const authInfo = getAuthInfoFromBrowserCookie();
                  if (!authInfo?.username) {
                    e.preventDefault();
                    router.push('/login?redirect=%2Fsearch');
                    return;
                  }
                  setActive('/search');
                }}
                onMouseEnter={() => prefetchRoute('/search')}
                data-active={active === '/search'}
                className={`group flex min-h-[40px] items-center rounded-lg px-2 py-2 pl-4 font-medium text-gray-700 transition-colors duration-200 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                  isCollapsed ? 'mx-0 w-full max-w-none' : 'mx-0'
                } justify-start gap-3`}
              >
                <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                  <Search className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                </div>
                <span
                  data-sidebar-label
                  className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
                    isCollapsed
                      ? 'max-w-0 opacity-0'
                      : 'max-w-[120px] opacity-100'
                  }`}
                >
                  搜索
                </span>
              </Link>
            </nav>

            {/* 菜单项 */}
            <div className='flex-1 overflow-y-auto px-2 pt-4'>
              <div className='space-y-1'>
                {menuItems.map((item) => {
                  // 检查当前路径是否匹配这个菜单项
                  const typeMatch = item.href.match(/type=([^&]+)/)?.[1];

                  // 解码URL以进行正确的比较
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
                      onClick={() => setActive(item.href)}
                      onMouseEnter={() => prefetchRoute(item.href)}
                      data-active={isActive}
                      className={`group flex min-h-[40px] items-center rounded-lg px-2 py-2 pl-4 text-sm text-gray-700 transition-colors duration-200 hover:bg-gray-100/30 hover:text-green-600 data-[active=true]:bg-green-500/20 data-[active=true]:text-green-700 dark:text-gray-300 dark:hover:text-green-400 dark:data-[active=true]:bg-green-500/10 dark:data-[active=true]:text-green-400 ${
                        isCollapsed ? 'mx-0 w-full max-w-none' : 'mx-0'
                      } justify-start gap-3`}
                    >
                      <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                        <Icon className='h-4 w-4 text-gray-500 group-hover:text-green-600 data-[active=true]:text-green-700 dark:text-gray-400 dark:group-hover:text-green-400 dark:data-[active=true]:text-green-400' />
                      </div>
                      <span
                        data-sidebar-label
                        className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
                          isCollapsed
                            ? 'max-w-0 opacity-0'
                            : 'max-w-[120px] opacity-100'
                        }`}
                      >
                        {item.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* 底部折叠/展开按钮 */}
            <div className='px-2 pb-4 pt-2'>
              <div className='mx-1 mb-2 h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent dark:via-gray-700' />
              <div className='space-y-1'>
                <UserMenu variant='sidebar' isCollapsed={isCollapsed} />
                <ThemeToggle variant='sidebar' isCollapsed={isCollapsed} />
                <button
                  onClick={handleToggle}
                  className={`group flex min-h-[40px] w-full items-center justify-start gap-3 rounded-lg px-2 py-2 pl-4 text-sm text-gray-500 transition-colors duration-200 hover:bg-gray-100/30 hover:text-green-600 dark:text-gray-400 dark:hover:text-green-400`}
                  title={isCollapsed ? '展开侧栏' : '折叠侧栏'}
                >
                  <div className='flex h-4 w-4 flex-shrink-0 items-center justify-center'>
                    <Menu className='h-4 w-4' />
                  </div>
                  <span
                    data-sidebar-label
                    className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
                      isCollapsed
                        ? 'max-w-0 opacity-0'
                        : 'max-w-[120px] opacity-100'
                    }`}
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
            isCollapsed ? 'w-16' : 'w-64'
          }`}
        ></div>
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
