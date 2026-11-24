'use client';

import { DEFAULT_SITE_ICON } from '@/lib/site-icon';

import { useSite } from './SiteProvider';

export const SiteIcon = () => {
  const { siteIcon, siteName } = useSite();

  return (
    <img
      src={siteIcon || DEFAULT_SITE_ICON}
      alt={siteName}
      className='h-full w-full object-contain'
      onError={(e) => {
        const img = e.target as HTMLImageElement;
        if (img.src !== window.location.origin + DEFAULT_SITE_ICON) {
          img.src = DEFAULT_SITE_ICON;
        }
      }}
    />
  );
};
