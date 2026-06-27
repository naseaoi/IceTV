import { BackButton } from './BackButton';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
  contentMode?: 'default' | 'player';
  showDesktopBack?: boolean;
}

const PageLayout = ({
  children,
  activePath = '/',
  contentMode = 'default',
  showDesktopBack: showDesktopBackOverride,
}: PageLayoutProps) => {
  const showMobileBack = ['/play', '/live'].includes(activePath);
  const showDesktopBack = showDesktopBackOverride ?? activePath === '/live';
  const isPlayerPage = contentMode === 'player' || activePath === '/play';

  return (
    <div className='min-h-screen w-full'>
      {/* 移动端头部 */}
      <MobileHeader showBackButton={showMobileBack} />

      {/* 主要布局容器 */}
      <div className='flex min-h-screen w-full md:grid md:grid-cols-[auto_1fr]'>
        {/* 侧边栏 - 桌面端显示，移动端隐藏 */}
        <div className='hidden md:block'>
          <Sidebar activePath={activePath} />
        </div>

        {/* 主内容区域 */}
        <div className='min-w-0 flex-1 transition-[margin] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] md:flex md:flex-col'>
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
                ? 'mb-0 mt-12 h-[calc(100dvh-3rem-3.5rem-env(safe-area-inset-bottom)-4px)] overflow-hidden md:h-auto md:overflow-visible'
                : 'mb-14 mt-12'
            }`}
            style={
              isPlayerPage
                ? undefined
                : {
                    paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
                  }
            }
          >
            {children}
          </main>
        </div>
      </div>

      {/* 移动端底部导航 */}
      <div className='md:hidden'>
        <MobileBottomNav activePath={activePath} />
      </div>
    </div>
  );
};

export default PageLayout;
