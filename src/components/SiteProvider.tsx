'use client';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  applyClientServerConfig,
  fetchClientServerConfig,
} from '@/lib/runtime-config';
import { withSiteIconCacheBuster } from '@/lib/site-icon';

const SiteContext = createContext<{
  siteName: string;
  siteIcon?: string;
  announcement?: string;
}>({
  // 默认值
  siteName: 'IceTV',
  siteIcon: '',
  announcement:
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
});

export const useSite = () => useContext(SiteContext);

function updateIconLink(selector: string, href: string) {
  const link = document.querySelector<HTMLLinkElement>(selector);
  if (link) {
    link.href = href;
  }
}

export function SiteProvider({
  children,
  siteName,
  siteIcon,
  announcement,
}: {
  children: ReactNode;
  siteName: string;
  siteIcon?: string;
  announcement?: string;
}) {
  const defaultAnnouncement =
    announcement ||
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';
  const [siteState, setSiteState] = useState({
    siteName,
    siteIcon: siteIcon || '',
    announcement: defaultAnnouncement,
  });

  useEffect(() => {
    let cancelled = false;

    fetchClientServerConfig()
      .then((data) => {
        applyClientServerConfig(data);
        if (cancelled) {
          return;
        }

        const nextSiteName = data.SiteName || siteName;
        const nextSiteIcon = withSiteIconCacheBuster(
          data.SiteIcon || '',
          Date.now(),
        );
        const nextAnnouncement = data.Announcement || defaultAnnouncement;

        setSiteState({
          siteName: nextSiteName,
          siteIcon: nextSiteIcon,
          announcement: nextAnnouncement,
        });

        document.title = nextSiteName;
        updateIconLink("link[rel='icon']", nextSiteIcon || '/favicon.ico');
        updateIconLink(
          "link[rel='apple-touch-icon']",
          nextSiteIcon || '/icons/icon-192x192.png',
        );
      })
      .catch(() => {
        if (typeof window !== 'undefined') {
          window.__runtimeConfigReady = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [defaultAnnouncement, siteName]);

  const value = useMemo(
    () => ({
      siteName: siteState.siteName,
      siteIcon: siteState.siteIcon,
      announcement: siteState.announcement,
    }),
    [siteState],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
