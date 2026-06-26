import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

import './globals.css';

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
  const runtimeConfig = {
    STORAGE_TYPE: storageType,
    OPEN_REGISTER: false,
    UPDATE_REPOS: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UPDATE_BRANCH: process.env.NEXT_PUBLIC_UPDATE_BRANCH || 'main',
    DOUBAN_PROXY_TYPE: process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct',
    DOUBAN_PROXY: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
    DOUBAN_IMAGE_PROXY_TYPE:
      process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE ||
      'cmliussss-cdn-tencent',
    DOUBAN_IMAGE_PROXY: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
    DISABLE_YELLOW_FILTER:
      process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
    ENABLE_LIVE_ENTRY: false,
    CUSTOM_CATEGORIES: [],
    FLUID_SEARCH: process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false',
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
