import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

import { getPublicConfig } from '@/lib/config';
import { SIDEBAR_COLLAPSED_STORAGE_KEY } from '@/lib/local-preferences';
import { serializeForInlineScript } from '@/lib/script-serialization';
import { getStorageType } from '@/lib/storage-type';
import { CURRENT_UPDATE_BRANCH } from '@/lib/version';

import { GlobalErrorIndicator } from '../components/GlobalErrorIndicator';
import { CardInteractionProvider } from '../components/CardInteractionProvider';
import { RuntimeConfigProvider } from '../components/RuntimeConfigProvider';
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
const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'IceTV';
const siteIcon = process.env.NEXT_PUBLIC_SITE_ICON || '';
const announcement =
  process.env.ANNOUNCEMENT ||
  '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';

export function generateMetadata(): Metadata {
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
  const publicConfig = await getPublicConfig();
  const initialSiteName = publicConfig.SiteName || siteName;
  const initialSiteIcon = publicConfig.SiteIcon || siteIcon;
  const initialAnnouncement = publicConfig.Announcement || announcement;
  const runtimeConfig = {
    STORAGE_TYPE: storageType,
    OPEN_REGISTER: publicConfig.OpenRegister,
    UPDATE_REPOS: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UPDATE_BRANCH: CURRENT_UPDATE_BRANCH,
    DOUBAN_PROXY_TYPE: publicConfig.DoubanProxyType,
    DOUBAN_PROXY: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
    BANGUMI_DATA_SOURCE: publicConfig.BangumiDataSource,
    BANGUMI_PROXY: process.env.NEXT_PUBLIC_BANGUMI_PROXY || '',
    DOUBAN_IMAGE_PROXY_TYPE: publicConfig.DoubanImageProxyType,
    DOUBAN_IMAGE_PROXY: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
    DISABLE_YELLOW_FILTER: publicConfig.DisableYellowFilter,
    ENABLE_LIVE_ENTRY: publicConfig.EnableLiveEntry,
    DEFAULT_AGGREGATE_SEARCH: publicConfig.DefaultAggregateSearch,
    ENABLE_OPTIMIZATION: publicConfig.EnableOptimization,
    AUTO_SWITCH_SOURCE_ON_TIMEOUT: publicConfig.AutoSwitchSourceOnTimeout,
    LIVE_DIRECT_CONNECT: publicConfig.LiveDirectConnect,
    CUSTOM_CATEGORIES: publicConfig.CustomCategories,
    FLUID_SEARCH: publicConfig.FluidSearch,
  };
  const serializedRuntimeConfig = serializeForInlineScript(runtimeConfig);
  const serializedSidebarCollapsedStorageKey = serializeForInlineScript(
    SIDEBAR_COLLAPSED_STORAGE_KEY,
  );

  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        <link
          rel='apple-touch-icon'
          href={initialSiteIcon || '/icons/icon-192x192.png'}
        />
        <link rel='icon' href={initialSiteIcon || '/favicon.ico'} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const saved = localStorage.getItem(${serializedSidebarCollapsedStorageKey});
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
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${serializedRuntimeConfig}; window.__runtimeConfigReady = false;`,
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
          <RuntimeConfigProvider initialConfig={runtimeConfig}>
            <SiteProvider
              siteName={initialSiteName}
              siteIcon={initialSiteIcon}
              announcement={initialAnnouncement}
            >
              <CardInteractionProvider>
                {children}
                <GlobalErrorIndicator />
                <SWRegister />
              </CardInteractionProvider>
            </SiteProvider>
          </RuntimeConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
