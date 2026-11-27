/** @jest-environment node */
import { cookies } from 'next/headers';

import {
  getListDetailPreview,
  getPlazaSkeletonCount,
} from '@/features/lists/lib/list-skeleton-counts.server';
import { getInitialDanmakuEnabled } from '@/features/play/lib/danmaku/preference.server';
import { getInitialProfileView } from '@/lib/user-profile.server';

jest.mock('next/server', () => {
  require('@/app/api/test-utils/web-polyfills').installWebPolyfills();
  return jest.requireActual('next/server');
});
jest.mock('next/headers', () => ({ cookies: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: {} }));
jest.mock('@/lib/auth-session.server', () => ({
  getServerAuthSession: jest.fn(),
}));
jest.mock('@/features/lists/lib/list-content-policy.server', () => ({
  getBlockedListSources: jest.fn(),
  visibleListItems: jest.fn(),
}));

it.each([
  ['plaza count', () => getPlazaSkeletonCount()],
  ['list preview', () => getListDetailPreview('list')],
  ['danmaku preference', () => getInitialDanmakuEnabled()],
  ['profile preview', () => getInitialProfileView('profile')],
])(
  'rethrows Next dynamic rendering signals before fallback/logging (%s)',
  async (_name, load) => {
    const error = Object.assign(new Error('Dynamic server usage'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    });
    (cookies as jest.Mock).mockRejectedValue(error);
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(load()).rejects.toBe(error);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  },
);

it.each([
  ['plaza count', () => getPlazaSkeletonCount()],
  ['list preview', () => getListDetailPreview('list')],
  ['danmaku preference', () => getInitialDanmakuEnabled()],
  ['profile preview', () => getInitialProfileView('profile')],
])(
  'retains the recoverable fallback for ordinary failures (%s)',
  async (_name, load) => {
    (cookies as jest.Mock).mockRejectedValue(new Error('cookie read failed'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(load()).resolves.toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  },
);
