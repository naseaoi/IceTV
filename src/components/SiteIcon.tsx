'use client';

import { useSite } from './SiteProvider';

const FALLBACK_ICON = '/icons/icon-192x192.png';

export const SiteIcon = () => {
  const { siteIcon, siteName } = useSite();

  return (
    <img
      src={siteIcon || FALLBACK_ICON}
      alt={siteName}
      className='h-full w-full object-contain'
      onError={(e) => {
        const img = e.target as HTMLImageElement;
        if (img.src !== window.location.origin + FALLBACK_ICON) {
          img.src = FALLBACK_ICON;
        }
      }}
    />
  );
};
