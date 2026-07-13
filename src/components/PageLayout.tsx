import { ReactNode } from 'react';

import { BackButton } from './BackButton';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import { ScrollToTopButton } from './ScrollToTopButton';
import Sidebar from './Sidebar';
import { SiteFooter } from './SiteFooter';

interface MobileHeaderConfig {
  title?: string;
  showBack?: boolean;
  actions?: ReactNode;
}

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  contentMode?: 'default' | 'player';
  showDesktopBack?: boolean;
  mobileHeader?: MobileHeaderConfig;
}

const PageLayout = ({
  children,
  activePath = '/',
  contentMode = 'default',
  showDesktopBack: showDesktopBackOverride,
  mobileHeader,
}: PageLayoutProps) => {
  const showMobileBack = ['/play', '/live'].includes(activePath);
  const showDesktopBack = showDesktopBackOverride ?? activePath === '/live';
  const isPlayerPage = contentMode === 'player' || activePath === '/play';
  const showBottomNav = !['/play', '/live'].includes(activePath);
  const showFooter = ['/', '/play', '/live'].includes(activePath);
  const showScrollToTop =
    !isPlayerPage && (activePath === '/' || activePath.startsWith('/douban'));

  return (
    <div className='min-h-screen w-full'>
      {/* 移动端头部 */}
      <MobileHeader
        title={mobileHeader?.title}
        showBack={mobileHeader?.showBack ?? showMobileBack}
        actions={mobileHeader?.actions}
      />

      {/* 主要布局容器 */}
      <div className='flex min-h-screen w-full md:grid md:grid-cols-[auto_1fr]'>
        {/* 侧边栏 - 桌面端显示，移动端隐藏 */}
        <div className='hidden md:block'>
          <Sidebar activePath={activePath} />
        </div>

        {/* 主内容区域 */}
        <div
          className={`min-w-0 flex-1 transition-[margin] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] md:flex md:flex-col ${
            isPlayerPage ? 'md:h-dvh md:min-h-0' : ''
          }`}
        >
          {/* 桌面端顶部工具栏 */}
          {showDesktopBack && (
            <div className='hidden items-center gap-1 px-4 py-2 sm:px-10 md:flex'>
              <div className='mx-auto flex w-full max-w-[95%] items-center gap-1'>
                <BackButton />
              </div>
            </div>
          )}

          {/* 主内容 */}
          <main
            className={`flex-1 md:mb-0 md:mt-0 md:min-h-0 ${
              isPlayerPage
                ? 'mb-0 mt-[calc(3rem+env(safe-area-inset-top))] flex h-[calc(100dvh-3rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)-4px)] flex-col overflow-hidden md:h-auto'
                : `${
                    activePath === '/search'
                      ? 'mt-0'
                      : 'mt-[calc(3rem+env(safe-area-inset-top))]'
                  } ${showBottomNav ? 'mb-14' : 'mb-0'}`
            }`}
            style={
              isPlayerPage
                ? undefined
                : {
                    paddingBottom:
                      showFooter || !showBottomNav
                        ? 'env(safe-area-inset-bottom)'
                        : 'calc(3.5rem + env(safe-area-inset-bottom))',
                  }
            }
          >
            {isPlayerPage && showFooter ? (
              <>
                <div className='min-h-0 flex-1 overflow-hidden'>{children}</div>
                <SiteFooter compact />
              </>
            ) : (
              <>
                {children}
                {showFooter && <SiteFooter />}
              </>
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
