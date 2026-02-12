import { BackButton } from './BackButton';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => {
  const showBack = ['/play', '/live'].includes(activePath);

  return (
    <div className='w-full min-h-screen'>
      {/* 移动端头部 */}
      <MobileHeader showBackButton={showBack} />

      {/* 主要布局容器 */}
      <div className='flex md:grid md:grid-cols-[auto_1fr] w-full min-h-screen md:min-h-auto'>
        {/* 侧边栏 - 桌面端显示，移动端隐藏 */}
        <div className='hidden md:block'>
          <Sidebar activePath={activePath} />
        </div>

        {/* 主内容区域 */}
        <div className='min-w-0 flex-1 transition-all duration-300'>
          {/* 桌面端顶部工具栏 */}
          <div className='hidden md:flex items-center justify-end px-4 sm:px-10 py-2 gap-1'>
            <div className='flex items-center w-full max-w-[95%] mx-auto gap-1'>
              {showBack && <BackButton />}
              <div className='flex-1' />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>

          {/* 主内容 */}
          <main
            className='flex-1 md:min-h-0 mb-14 md:mb-0 md:mt-0 mt-12'
            style={{
              paddingBottom: 'calc(3.5rem + env(safe-area-inset-bottom))',
            }}
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
