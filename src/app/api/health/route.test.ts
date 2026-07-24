/** @jest-environment node */

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';

describe('health route', () => {
  beforeAll(() => {
    installWebPolyfills();
  });

  it.each(['GET', 'HEAD'] as const)(
    '%s returns an empty 204 response',
    (method) => {
      const route = require('./route') as typeof import('./route');
      const response = route[method]();

      expect(response.status).toBe(204);
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );
});
