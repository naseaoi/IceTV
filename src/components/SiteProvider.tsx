'use client';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import { clearSearchSnapshotCache } from '@/features/search/lib/searchSnapshotCache';
import { useVisibilityPolling } from '@/hooks/useVisibilityPolling';
import {
  type ServerConfigPayload,
  applyClientServerConfig,
  fetchClientServerConfig,
  invalidateClientServerConfig,
  SERVER_CONFIG_INVALIDATION_CHANNEL,
  SERVER_CONFIG_INVALIDATION_SOURCE,
  SERVER_CONFIG_UPDATED_EVENT,
} from '@/lib/runtime-config';
import {
  DEFAULT_SITE_FOOTER_TEXT,
  normalizeSiteFooterText,
} from '@/lib/site-footer';
import {
  DEFAULT_APPLE_TOUCH_ICON,
  DEFAULT_FAVICON,
  withSiteIconCacheBuster,
} from '@/lib/site-icon';

const SiteContext = createContext<{
  siteName: string;
  siteIcon?: string;
  announcement?: string;
  footerText: string;
}>({
  siteName: 'IceTV',
  siteIcon: '',
  announcement:
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
  footerText: DEFAULT_SITE_FOOTER_TEXT,
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
  footerText,
}: {
  children: ReactNode;
  siteName: string;
  siteIcon?: string;
  announcement?: string;
  footerText?: string;
}) {
  const { session } = useAuthSession();
  const account =
    session.status === 'authenticated'
      ? `${session.username}:${session.role}`
      : '';
  const previousAccount = useRef(account);
  const refreshRef = useRef<() => void>(() => {});
  const defaultAnnouncement =
    announcement ||
    '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。';
  const defaultFooterText = normalizeSiteFooterText(footerText);
  const [siteState, setSiteState] = useState({
    siteName,
    siteIcon: siteIcon || '',
    announcement: defaultAnnouncement,
    footerText: defaultFooterText,
  });

  useEffect(() => {
    let appliedData: ServerConfigPayload | undefined;
    const updateSite = (event: Event) => {
      const data = (event as CustomEvent<ServerConfigPayload>).detail;
      appliedData = data;
      const nextSiteName = data.SiteName || siteName;
      const nextSiteIcon = withSiteIconCacheBuster(
        data.SiteIcon || '',
        Date.now(),
      );
      const nextAnnouncement = data.Announcement || defaultAnnouncement;
      const nextFooterText = normalizeSiteFooterText(
        data.FooterText || defaultFooterText,
      );

      setSiteState({
        siteName: nextSiteName,
        siteIcon: nextSiteIcon,
        announcement: nextAnnouncement,
        footerText: nextFooterText,
      });

      document.title = nextSiteName;
      updateIconLink("link[rel='icon']", nextSiteIcon || DEFAULT_FAVICON);
      updateIconLink(
        "link[rel='apple-touch-icon']",
        nextSiteIcon || DEFAULT_APPLE_TOUCH_ICON,
      );
    };
    window.addEventListener(SERVER_CONFIG_UPDATED_EVENT, updateSite);

    let cancelled = false;
    const refresh = (forceFresh = false) => {
      if (document.visibilityState !== 'visible') return;
      fetchClientServerConfig({ forceFresh })
        .then((data) => {
          if (!cancelled && data !== appliedData) applyClientServerConfig(data);
        })
        .catch(() => {
          if (!cancelled) window.__runtimeConfigReady = true;
        });
    };
    refreshRef.current = refresh;
    const accountChanged = previousAccount.current !== account;
    previousAccount.current = account;
    if (accountChanged) {
      invalidateClientServerConfig();
      if (!account) applyClientServerConfig({});
    }
    if (account || accountChanged) refresh();
    else window.__runtimeConfigReady = true;

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(SERVER_CONFIG_INVALIDATION_CHANNEL)
        : null;
    if (channel)
      channel.onmessage = ({ data }) => {
        if (
          data?.type !== 'invalidate' ||
          data.source === SERVER_CONFIG_INVALIDATION_SOURCE
        )
          return;
        invalidateClientServerConfig();
        clearSearchSnapshotCache();
        refresh(true);
      };

    return () => {
      cancelled = true;
      channel?.close();
      window.removeEventListener(SERVER_CONFIG_UPDATED_EVENT, updateSite);
    };
  }, [account, defaultAnnouncement, defaultFooterText, siteName]);

  useVisibilityPolling({
    enabled: true,
    intervalMs: 60_000,
    onPoll: () => refreshRef.current(),
  });

  const value = useMemo(
    () => ({
      siteName: siteState.siteName,
      siteIcon: siteState.siteIcon,
      announcement: siteState.announcement,
      footerText: siteState.footerText,
    }),
    [siteState],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
