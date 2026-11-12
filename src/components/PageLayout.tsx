import { ReactNode } from 'react';

import { BackButton } from './BackButton';
import { isChannelPath } from './channel-nav';
import MobileChannelHeader from './mobile/MobileChannelHeader';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import { PAGE_CONTAINER_CLASS } from './page-container';
import { ScrollToTopButton } from './ScrollToTopButton';
import { SiteFooter } from './SiteFooter';
import TopNav from './TopNav';

export interface MobileHeaderConfig {
  title?: string;
  showBack?: boolean;
  actions?: ReactNode;
}

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  contentMode?: 'default' | 'player';
  showDesktopBack?: boolean;
  // false 表示页面自带移动端顶部区域，不渲染通用顶栏
  mobileHeader?: MobileHeaderConfig | false;
  transparentTopNav?: boolean;
}

const PageLayout = ({
  children,
  activePath = '/',
  contentMode = 'default',
  showDesktopBack: showDesktopBackOverride,
  mobileHeader,
  transparentTopNav = false,
}: PageLayoutProps) => {
  const hasChannelHeader = mobileHeader !== false && isChannelPath(activePath);
  const showDesktopBack = showDesktopBackOverride ?? activePath === '/live';
  const isPlayerPage = contentMode === 'player' || activePath === '/play';
  const showBottomNav = !['/play', '/live'].includes(activePath);
  // 免责声明只放在首页底部，播放页保持沉浸
  const showFooter = !isPlayerPage && activePath === '/';
  const showScrollToTop =
    !isPlayerPage &&
    (activePath === '/' ||
      activePath.startsWith('/douban') ||
      activePath === '/lists' ||
      activePath === '/search');

  return (
    <div className='min-h-screen w-full'>
      {mobileHeader === false ? null : hasChannelHeader ? (
        <MobileChannelHeader
          activePath={activePath}
          transparentAtTop={transparentTopNav}
        />
      ) : (
        <MobileHeader
          title={mobileHeader?.title}
          showBack={mobileHeader?.showBack}
          actions={mobileHeader?.actions}
        />
      )}

      {/* 主要布局容器 */}
      <div className='flex min-h-screen w-full'>
        <div
          className={`flex min-w-0 flex-1 flex-col ${
            isPlayerPage ? 'h-dvh min-h-0' : ''
          }`}
        >
          <TopNav
            activePath={activePath}
            transparentAtTop={transparentTopNav}
          />

          {/* 桌面端顶部工具栏 */}
          {showDesktopBack && (
            <div className='hidden py-2 md:block'>
              <div
                className={`${PAGE_CONTAINER_CLASS} flex items-center gap-1`}
              >
                <BackButton />
              </div>
            </div>
          )}

          {/* 主内容 */}
          <main
            className={`min-h-0 flex-1 md:mb-0 md:mt-0 ${
              isPlayerPage
                ? 'mb-0 mt-[calc(3rem+env(safe-area-inset-top))] flex h-[calc(100dvh-3rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)-4px)] flex-col overflow-hidden md:h-auto'
                : `${
                    mobileHeader === false ||
                    (hasChannelHeader && transparentTopNav)
                      ? 'mt-0'
                      : hasChannelHeader
                        ? 'mt-[calc(5.5rem+env(safe-area-inset-top))]'
                        : 'mt-[calc(3rem+env(safe-area-inset-top))]'
                  } mb-0 ${showFooter ? 'flex flex-col' : ''} ${
                    showBottomNav
                      ? 'pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-[env(safe-area-inset-bottom)]'
                      : 'pb-[env(safe-area-inset-bottom)]'
                  }`
            }`}
          >
            {showFooter ? (
              <>
                <div className='flex-1'>{children}</div>
                <SiteFooter />
              </>
            ) : isPlayerPage ? (
              <div className='min-h-0 flex-1 overflow-hidden'>{children}</div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>

      {/* 移动端底部导航 */}
      {showBottomNav && (
        <div className='md:hidden'>
          <MobileBottomNav />
        </div>
      )}

      {showScrollToTop && <ScrollToTopButton />}
    </div>
  );
};

export default PageLayout;
