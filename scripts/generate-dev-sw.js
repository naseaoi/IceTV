const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '..', 'public', 'sw.js');
const source = `self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
      await self.registration.unregister();

      const windowClients = await self.clients.matchAll({ type: 'window' });
      await Promise.all(windowClients.map((client) => client.navigate(client.url)));
    })(),
  );
});
`;

fs.writeFileSync(swPath, source, 'utf8');
console.log('Generated development service worker cleanup script.');
