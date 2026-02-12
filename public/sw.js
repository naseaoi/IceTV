if (!self.define) {
  let e,
    a = {};
  const s = (s, i) => (
    (s = new URL(s + '.js', i).href),
    a[s] ||
      new Promise((a) => {
        if ('document' in self) {
          const e = document.createElement('script');
          ((e.src = s), (e.onload = a), document.head.appendChild(e));
        } else ((e = s), importScripts(s), a());
      }).then(() => {
        let e = a[s];
        if (!e) throw new Error(`Module ${s} didn’t register its module`);
        return e;
      })
  );
  self.define = (i, c) => {
    const n =
      e ||
      ('document' in self ? document.currentScript.src : '') ||
      location.href;
    if (a[n]) return;
    let t = {};
    const r = (e) => s(e, n),
      o = { module: { uri: n }, exports: t, require: r };
    a[n] = Promise.all(i.map((e) => o[e] || r(e))).then((e) => (c(...e), t));
  };
}
define(['./workbox-e9849328'], function (e) {
  'use strict';
  (importScripts(),
    self.skipWaiting(),
    e.clientsClaim(),
    e.precacheAndRoute(
      [
        {
          url: '/_next/static/O9mPuvZgFeTvoqSDoL5Wk/_buildManifest.js',
          revision: '6e0e784f7020685e15dbca085ec0b327',
        },
        {
          url: '/_next/static/O9mPuvZgFeTvoqSDoL5Wk/_ssgManifest.js',
          revision: 'b6652df95db52feb4daf4eca35380933',
        },
        {
          url: '/_next/static/chunks/1109-38a1de6599508c1e.js',
          revision: '38a1de6599508c1e',
        },
        {
          url: '/_next/static/chunks/1399-fa94bbc1800a3b10.js',
          revision: 'fa94bbc1800a3b10',
        },
        {
          url: '/_next/static/chunks/1406-ad41032758c255d3.js',
          revision: 'ad41032758c255d3',
        },
        {
          url: '/_next/static/chunks/2184-94228adc79087b8b.js',
          revision: '94228adc79087b8b',
        },
        {
          url: '/_next/static/chunks/2571-97eb8d59aec2af1d.js',
          revision: '97eb8d59aec2af1d',
        },
        {
          url: '/_next/static/chunks/2922.682797e46620cda2.js',
          revision: '682797e46620cda2',
        },
        {
          url: '/_next/static/chunks/4602-818b906e5b1a0b6d.js',
          revision: '818b906e5b1a0b6d',
        },
        {
          url: '/_next/static/chunks/483-f03bab21e1fd08a2.js',
          revision: 'f03bab21e1fd08a2',
        },
        {
          url: '/_next/static/chunks/6407.8fbed1a1b4293227.js',
          revision: '8fbed1a1b4293227',
        },
        {
          url: '/_next/static/chunks/9463-0e9e2d48e83070b0.js',
          revision: '0e9e2d48e83070b0',
        },
        {
          url: '/_next/static/chunks/9482-fee74c42161518b8.js',
          revision: 'fee74c42161518b8',
        },
        {
          url: '/_next/static/chunks/app/_global-error/page-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/_not-found/page-c64db9c651241f0b.js',
          revision: 'c64db9c651241f0b',
        },
        {
          url: '/_next/static/chunks/app/admin/page-8ff7491f40cbd6d1.js',
          revision: '8ff7491f40cbd6d1',
        },
        {
          url: '/_next/static/chunks/app/api/admin/category/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/config/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/config_file/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/config_subscription/fetch/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/data_migration/export/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/data_migration/import/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/live/refresh/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/live/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/reset/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/site/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/source/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/source/validate/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/admin/user/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/auth/session/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/change-password/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/cron/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/detail/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/douban/categories/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/douban/recommends/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/douban/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/favorites/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/image-proxy/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/live/channels/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/live/epg/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/live/precheck/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/live/sources/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/login/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/logout/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/playrecords/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/proxy/key/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/proxy/logo/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/proxy/m3u8/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/proxy/segment/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/search/one/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/search/resources/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/search/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/search/suggestions/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/search/ws/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/searchhistory/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/server-config/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/api/skipconfigs/route-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/app/douban/page-ce66bd121dded865.js',
          revision: 'ce66bd121dded865',
        },
        {
          url: '/_next/static/chunks/app/layout-9106f71d7cd2629f.js',
          revision: '9106f71d7cd2629f',
        },
        {
          url: '/_next/static/chunks/app/live/page-f0a0013e0b6d8ec2.js',
          revision: 'f0a0013e0b6d8ec2',
        },
        {
          url: '/_next/static/chunks/app/login/page-f17fe3787cb518a5.js',
          revision: 'f17fe3787cb518a5',
        },
        {
          url: '/_next/static/chunks/app/page-83f5ecd466e0c569.js',
          revision: '83f5ecd466e0c569',
        },
        {
          url: '/_next/static/chunks/app/play/page-d74fa36e4709bf67.js',
          revision: 'd74fa36e4709bf67',
        },
        {
          url: '/_next/static/chunks/app/search/page-2e6bf94f90f5fc28.js',
          revision: '2e6bf94f90f5fc28',
        },
        {
          url: '/_next/static/chunks/app/warning/page-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/d5b6d25f-5b28156c30d129f1.js',
          revision: '5b28156c30d129f1',
        },
        {
          url: '/_next/static/chunks/deb030d4-d09e16096fe77d71.js',
          revision: 'd09e16096fe77d71',
        },
        {
          url: '/_next/static/chunks/framework-af674a464d67f8cb.js',
          revision: 'af674a464d67f8cb',
        },
        {
          url: '/_next/static/chunks/main-app-d07e7a3d4e9a6fa4.js',
          revision: 'd07e7a3d4e9a6fa4',
        },
        {
          url: '/_next/static/chunks/main-e075ea6dd9f0cf92.js',
          revision: 'e075ea6dd9f0cf92',
        },
        {
          url: '/_next/static/chunks/next/dist/client/components/builtin/app-error-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/next/dist/client/components/builtin/forbidden-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/next/dist/client/components/builtin/global-error-c683bc1fc1f0d546.js',
          revision: 'c683bc1fc1f0d546',
        },
        {
          url: '/_next/static/chunks/next/dist/client/components/builtin/not-found-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/next/dist/client/components/builtin/unauthorized-86892aa44eb7c352.js',
          revision: '86892aa44eb7c352',
        },
        {
          url: '/_next/static/chunks/polyfills-42372ed130431b0a.js',
          revision: '846118c33b2c0e922d7b3a7676f81f6f',
        },
        {
          url: '/_next/static/chunks/webpack-f621c10d7acef2ab.js',
          revision: 'f621c10d7acef2ab',
        },
        {
          url: '/_next/static/css/460cd3379e39750f.css',
          revision: '460cd3379e39750f',
        },
        {
          url: '/_next/static/css/7e7d96b1e6991756.css',
          revision: '7e7d96b1e6991756',
        },
        {
          url: '/_next/static/media/19cfc7226ec3afaa-s.woff2',
          revision: '9dda5cfc9a46f256d0e131bb535e46f8',
        },
        {
          url: '/_next/static/media/21350d82a1f187e9-s.woff2',
          revision: '4e2553027f1d60eff32898367dd4d541',
        },
        {
          url: '/_next/static/media/8e9860b6e62d6359-s.woff2',
          revision: '01ba6c2a184b8cba08b0d57167664d75',
        },
        {
          url: '/_next/static/media/ba9851c3c22cd980-s.woff2',
          revision: '9e494903d6b0ffec1a1e14d34427d44d',
        },
        {
          url: '/_next/static/media/c5fe6dc8356a8c31-s.woff2',
          revision: '027a89e9ab733a145db70f09b8a18b42',
        },
        {
          url: '/_next/static/media/df0a9ae256c0569c-s.woff2',
          revision: 'd54db44de5ccb18886ece2fda72bdfe0',
        },
        {
          url: '/_next/static/media/e4af272ccee01ff0-s.p.woff2',
          revision: '65850a373e258f1c897a2b3d75eb74de',
        },
        { url: '/favicon.ico', revision: '2a440afb7f13a0c990049fc7c383bdd4' },
        {
          url: '/icons/icon-192x192.png',
          revision: 'e214d3db80d2eb6ef7a911b3f9433b81',
        },
        {
          url: '/icons/icon-256x256.png',
          revision: 'a5cd7490191373b684033f1b33c9d9da',
        },
        {
          url: '/icons/icon-384x384.png',
          revision: '8540e29a41812989d2d5bf8f61e1e755',
        },
        {
          url: '/icons/icon-512x512.png',
          revision: '3e5597604f2c5d99d7ab62b02f6863d3',
        },
        { url: '/logo.png', revision: '5c1047adbe59b9a91cc7f8d3d2f95ef4' },
        { url: '/manifest.json', revision: '6a88bd8e4d722a7046a7e43050b208e3' },
        { url: '/robots.txt', revision: 'e2b2cd8514443456bc6fb9d77b3b1f3e' },
        {
          url: '/screenshot1.png',
          revision: 'd7de3a25686c5b9c9d8c8675bc6109fc',
        },
        {
          url: '/screenshot2.png',
          revision: 'b0b715a3018d2f02aba5d94762473bb6',
        },
        {
          url: '/screenshot3.png',
          revision: '7e454c28e110e291ee12f494fb3cf40c',
        },
      ],
      { ignoreURLParametersMatching: [] },
    ),
    e.cleanupOutdatedCaches(),
    e.registerRoute(
      '/',
      new e.NetworkFirst({
        cacheName: 'start-url',
        plugins: [
          {
            cacheWillUpdate: async ({
              request: e,
              response: a,
              event: s,
              state: i,
            }) =>
              a && 'opaqueredirect' === a.type
                ? new Response(a.body, {
                    status: 200,
                    statusText: 'OK',
                    headers: a.headers,
                  })
                : a,
          },
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
      new e.CacheFirst({
        cacheName: 'google-fonts-webfonts',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 31536e3 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
      new e.StaleWhileRevalidate({
        cacheName: 'google-fonts-stylesheets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 604800 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-font-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 4, maxAgeSeconds: 604800 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-image-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\/_next\/image\?url=.+$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'next-image',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:mp3|wav|ogg)$/i,
      new e.CacheFirst({
        cacheName: 'static-audio-assets',
        plugins: [
          new e.RangeRequestsPlugin(),
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:mp4)$/i,
      new e.CacheFirst({
        cacheName: 'static-video-assets',
        plugins: [
          new e.RangeRequestsPlugin(),
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:js)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-js-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:css|less)$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'static-style-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\/_next\/data\/.+\/.+\.json$/i,
      new e.StaleWhileRevalidate({
        cacheName: 'next-data',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      /\.(?:json|xml|csv)$/i,
      new e.NetworkFirst({
        cacheName: 'static-data-assets',
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      ({ url: e }) => {
        if (!(self.origin === e.origin)) return !1;
        const a = e.pathname;
        return !a.startsWith('/api/auth/') && !!a.startsWith('/api/');
      },
      new e.NetworkFirst({
        cacheName: 'apis',
        networkTimeoutSeconds: 10,
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      ({ url: e }) => {
        if (!(self.origin === e.origin)) return !1;
        return !e.pathname.startsWith('/api/');
      },
      new e.NetworkFirst({
        cacheName: 'others',
        networkTimeoutSeconds: 10,
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 86400 }),
        ],
      }),
      'GET',
    ),
    e.registerRoute(
      ({ url: e }) => !(self.origin === e.origin),
      new e.NetworkFirst({
        cacheName: 'cross-origin',
        networkTimeoutSeconds: 10,
        plugins: [
          new e.ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 3600 }),
        ],
      }),
      'GET',
    ));
});
