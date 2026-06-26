import type { Metadata, Viewport } from 'next';
import { unstable_noStore as noStore } from 'next/cache';
import { Inter } from 'next/font/google';

import './globals.css';

import { getConfig } from '@/lib/config';
import { serializeForInlineScript } from '@/lib/script-serialization';
import { getStorageType } from '@/lib/storage-type';

import { GlobalErrorIndicator } from '../components/GlobalErrorIndicator';
import { CardInteractionProvider } from '../components/CardInteractionProvider';
import { SiteProvider } from '../components/SiteProvider';
import { SWRegister } from '../components/SWRegister';
import { ThemeProvider } from '../components/ThemeProvider';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  fallback: [
    'system-ui',
    '-apple-system',
    'PingFang SC',
    'Microsoft YaHei',
    'Hiragino Sans GB',
    'Noto Sans SC',
    'sans-serif',
  ],
});

const storageType = getStorageType();
const shouldUseDynamicConfig = true;

// 动态生成 metadata，支持配置更新后的标题变化
export async function generateMetadata(): Promise<Metadata> {
  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'IceTV';

  if (shouldUseDynamicConfig) {
    noStore();
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
  }

  return {
    title: siteName,
    description: '影视聚合',
    manifest: '/manifest.json',
  };
}

export const viewport: Viewport = {
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (shouldUseDynamicConfig) {
    noStore();
  }

  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'IceTV';
  let siteIcon = '';
  let announcement =
    process.env.ANNOUNCEMENT ||
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';

  let doubanProxyType = process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct';
  let doubanProxy = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';
  let doubanImageProxyType =
    process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'cmliussss-cdn-tencent';
  let doubanImageProxy = process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '';
  let disableYellowFilter =
    process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true';
  let enableLiveEntry = false;
  let fluidSearch = process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false';
  let openRegister = false;
  let customCategories = [] as {
    name: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  if (shouldUseDynamicConfig) {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
    siteIcon = config.SiteConfig.SiteIcon || '';
    announcement = config.SiteConfig.Announcement;

    doubanProxyType = config.SiteConfig.DoubanProxyType;
    doubanProxy = config.SiteConfig.DoubanProxy;
    doubanImageProxyType = config.SiteConfig.DoubanImageProxyType;
    doubanImageProxy = config.SiteConfig.DoubanImageProxy;
    disableYellowFilter = config.SiteConfig.DisableYellowFilter;
    enableLiveEntry = config.SiteConfig.EnableLiveEntry;
    customCategories = config.CustomCategories.filter(
      (category) => !category.disabled,
    ).map((category) => ({
      name: category.name || '',
      type: category.type,
      query: category.query,
    }));
    fluidSearch = config.SiteConfig.FluidSearch;
    openRegister = !!config.UserConfig.OpenRegister;
  }

  // 将运行时配置注入到全局 window 对象，供客户端在运行时读取
  const runtimeConfig = {
    STORAGE_TYPE: storageType,
    OPEN_REGISTER: openRegister,
    UPDATE_REPOS: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UPDATE_BRANCH: process.env.NEXT_PUBLIC_UPDATE_BRANCH || 'main',
    DOUBAN_PROXY_TYPE: doubanProxyType,
    DOUBAN_PROXY: doubanProxy,
    DOUBAN_IMAGE_PROXY_TYPE: doubanImageProxyType,
    DOUBAN_IMAGE_PROXY: doubanImageProxy,
    DISABLE_YELLOW_FILTER: disableYellowFilter,
    ENABLE_LIVE_ENTRY: enableLiveEntry,
    CUSTOM_CATEGORIES: customCategories,
    FLUID_SEARCH: fluidSearch,
  };
  const serializedRuntimeConfig = serializeForInlineScript(runtimeConfig);

  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        <link
          rel='apple-touch-icon'
          href={siteIcon || '/icons/icon-192x192.png'}
        />
        <link rel='icon' href={siteIcon || '/favicon.ico'} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const saved = localStorage.getItem('sidebarCollapsed');
    if (saved === null) return;
    const collapsed = JSON.parse(saved) === true;
    window.__sidebarCollapsed = collapsed;
    if (collapsed) {
      document.documentElement.dataset.sidebarCollapsed = 'true';
    }
  } catch {}
})();`,
          }}
        />
        {/* 将配置序列化后直接写入脚本，浏览器端可通过 window.RUNTIME_CONFIG 获取 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${serializedRuntimeConfig};`,
          }}
        />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-200`}
      >
        <ThemeProvider
          attribute='class'
          defaultTheme='dark'
          enableSystem
          disableTransitionOnChange
        >
          <SiteProvider
            siteName={siteName}
            siteIcon={siteIcon}
            announcement={announcement}
          >
            <CardInteractionProvider>
              {children}
              <GlobalErrorIndicator />
              <SWRegister />
            </CardInteractionProvider>
          </SiteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
