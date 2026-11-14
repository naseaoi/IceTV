import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import {
  ListPlazaPageClient,
  ListPlazaPageSkeleton,
} from '@/features/lists/components/ListPlazaPageClient';

jest.mock('@/components/AuthProvider', () => ({
  useAuthSession: () => ({ session: { status: 'authenticated' } }),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/features/lists/lib/lists-client', () => ({
  fetchPlazaLists: jest.fn(() => new Promise(() => undefined)),
}));

it('路由 loading 未知总数时只转圈，进入过广场后按服务端总数铺骨架', () => {
  const { unmount } = render(<ListPlazaPageSkeleton />);
  expect(screen.queryByRole('status', { name: '加载中' })).toBeNull();
  expect(document.querySelector('.ice-spinner')).not.toBeNull();
  unmount();

  render(<ListPlazaPageClient initialTotal={2} />).unmount();

  render(<ListPlazaPageSkeleton />);
  expect(screen.getByRole('status', { name: '加载中' }).children).toHaveLength(
    2,
  );
  expect(document.querySelector('.ice-spinner')).toBeNull();
});
