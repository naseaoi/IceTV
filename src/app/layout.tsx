import './globals.css';

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { cookies } from 'next/headers';

import { AuthProvider } from '@/components/AuthProvider';
import { CardInteractionProvider } from '@/components/CardInteractionProvider';
import { ClientErrorReporter } from '@/components/ClientErrorReporter';
import { LinuxDoBindNotifier } from '@/components/LinuxDoBindNotifier';
import { MessageCenterProvider } from '@/components/messages/MessageCenterProvider';
import { PageScrollRestorer } from '@/components/PageScrollRestorer';
import ReleaseNotifier from '@/components/ReleaseNotifier';
import { RuntimeConfigProvider } from '@/components/RuntimeConfigProvider';
import { SiteProvider } from '@/components/SiteProvider';
import { SWRegister } from '@/components/SWRegister';
import { ThemeProvider } from '@/components/ThemeProvider';
import ToastViewport from '@/components/ToastViewport';
import { AdminAlertsProvider } from '@/features/admin/components/AdminAlertsProvider';
import { ListPickerProvider } from '@/features/lists/components/ListPickerProvider';
import { WatchRecordProvider } from '@/features/watch-record/WatchRecordProvider';
import { getServerAuthSession } from '@/lib/auth-session.server';
import { getConfigForRead, getPublicConfig } from '@/lib/config';
import { canUserWatchLive } from '@/lib/live-access.server';
import { serializeForInlineScript } from '@/lib/script-serialization';
import { DEFAULT_SITE_FOOTER_TEXT } from '@/lib/site-footer';
import { DEFAULT_APPLE_TOUCH_ICON } from '@/lib/site-icon';
import { getStorageType } from '@/lib/storage-type';
import { buildThemeInitScript, DEFAULT_THEME } from '@/lib/theme-preference';
import { CURRENT_UPDATE_BRANCH } from '@/lib/version';

// 不用 next/font/google：构建时联网下载，Google 偶发异常会让构建失败。年度报告的细字重也取自这里
const inter = localFont({
  src: './fonts/inter-latin-wght.woff2',
  weight: '200 800',
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
const footerText = DEFAULT_SITE_FOOTER_TEXT;

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
  const cookieStore = await cookies();
  const sessionPromise = getServerAuthSession(cookieStore.get('auth')?.value);
  const liveAccessPromise = Promise.all([
    sessionPromise,
    getConfigForRead(),
  ]).then(([session, config]) =>
    canUserWatchLive(
      session.status === 'authenticated' ? session.username : undefined,
      config,
    ),
  );
  const [initialAuthSession, publicConfig, enableLiveEntry] = await Promise.all(
    [sessionPromise, getPublicConfig(), liveAccessPromise],
  );
  const initialSiteName = publicConfig.SiteName || siteName;
  const initialSiteIcon = publicConfig.SiteIcon || siteIcon;
  const initialAnnouncement = publicConfig.Announcement || announcement;
  const initialFooterText = publicConfig.FooterText || footerText;
  const runtimeConfig = {
    STORAGE_TYPE: storageType,
    OPEN_REGISTER: publicConfig.OpenRegister,
    LINUXDO_LOGIN: publicConfig.LinuxDoLogin,
    REQUIRE_INVITE_CODE: publicConfig.RequireInviteCode,
    UPDATE_REPOS: process.env.NEXT_PUBLIC_UPDATE_REPOS || 'naseaoi/IceTV',
    UPDATE_BRANCH: CURRENT_UPDATE_BRANCH,
    DOUBAN_PROXY_TYPE: publicConfig.DoubanProxyType,
    DOUBAN_PROXY: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
    DOUBAN_IMAGE_PROXY_TYPE: publicConfig.DoubanImageProxyType,
    DOUBAN_IMAGE_PROXY: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
    ENABLE_LIVE_ENTRY: enableLiveEntry,
    DEFAULT_AGGREGATE_SEARCH: publicConfig.DefaultAggregateSearch,
    ENABLE_OPTIMIZATION: publicConfig.EnableOptimization,
    AUTO_SWITCH_SOURCE: publicConfig.AutoSwitchSource,
    ENABLE_DANMAKU: publicConfig.EnableDanmaku,
    ENABLE_USER_DANMAKU: publicConfig.EnableUserDanmaku,
    CUSTOM_CATEGORIES: publicConfig.CustomCategories,
    FLUID_SEARCH: publicConfig.FluidSearch,
    VOD_PAGE_TIMEOUT_SECONDS: publicConfig.VodPageTimeoutSeconds,
    VOD_FRAGMENT_TIMEOUT_SECONDS: publicConfig.VodFragmentTimeoutSeconds,
    PLAYBACK_HISTORY_PAGE_SIZE: publicConfig.PlaybackHistoryPageSize,
    SEARCH_HISTORY_LIMIT: publicConfig.SearchHistoryLimit,
    CONTINUE_WATCHING_LIMIT: publicConfig.ContinueWatchingLimit,
    COVER_IMAGE_CACHE_SIZE: publicConfig.CoverImageCacheSize,
    IMAGE_PROXY_TIMEOUT_SECONDS: publicConfig.ImageProxyTimeoutSeconds,
    SOURCE_COVER_PROXY_MODE: publicConfig.SourceCoverProxyMode,
  };
  const serializedRuntimeConfig = serializeForInlineScript(runtimeConfig);
  const runtimeConfigReadyForGuest = initialAuthSession.status === 'guest';

  return (
    <html lang='zh-CN' className={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: buildThemeInitScript(),
          }}
        />
        <link
          rel='apple-touch-icon'
          href={initialSiteIcon || DEFAULT_APPLE_TOUCH_ICON}
        />
        <link rel='icon' href={initialSiteIcon || '/favicon.ico'} />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${serializedRuntimeConfig}; window.__runtimeConfigReady = ${runtimeConfigReadyForGuest ? 'true' : 'false'};`,
          }}
        />
      </head>
      <body
        className={`${inter.className} min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-200`}
      >
        <ThemeProvider disableTransitionOnChange>
          <RuntimeConfigProvider initialConfig={runtimeConfig}>
            <SiteProvider
              siteName={initialSiteName}
              siteIcon={initialSiteIcon}
              announcement={initialAnnouncement}
              footerText={initialFooterText}
            >
              <AuthProvider initialSession={initialAuthSession}>
                <AdminAlertsProvider>
                  <MessageCenterProvider>
                    <CardInteractionProvider>
                      <WatchRecordProvider>
                        <ListPickerProvider>{children}</ListPickerProvider>
                      </WatchRecordProvider>
                      <PageScrollRestorer />
                      <ClientErrorReporter />
                      <ToastViewport />
                      <LinuxDoBindNotifier />
                      <ReleaseNotifier />
                      <SWRegister />
                    </CardInteractionProvider>
                  </MessageCenterProvider>
                </AdminAlertsProvider>
              </AuthProvider>
            </SiteProvider>
          </RuntimeConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
