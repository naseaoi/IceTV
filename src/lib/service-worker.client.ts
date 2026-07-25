const DEV_SW_RELOAD_MARKER = 'icetv:dev-sw-cleanup-reload';

export async function cleanupDevelopmentServiceWorker(): Promise<boolean> {
  const hadController = Boolean(navigator.serviceWorker.controller);
  const registrations = await navigator.serviceWorker.getRegistrations();
  const cacheNames =
    typeof window !== 'undefined' && 'caches' in window
      ? await window.caches.keys()
      : [];

  await Promise.allSettled([
    ...registrations.map((registration) => registration.unregister()),
    ...cacheNames.map((cacheName) => window.caches.delete(cacheName)),
  ]);

  if (!hadController) {
    window.sessionStorage.removeItem(DEV_SW_RELOAD_MARKER);
    return false;
  }

  if (window.sessionStorage.getItem(DEV_SW_RELOAD_MARKER) === '1') {
    window.sessionStorage.removeItem(DEV_SW_RELOAD_MARKER);
    return false;
  }

  window.sessionStorage.setItem(DEV_SW_RELOAD_MARKER, '1');
  return true;
}
