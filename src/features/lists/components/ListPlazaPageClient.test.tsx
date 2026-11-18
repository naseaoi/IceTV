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

it('路由 loading 未知总数时只转圈，已知总数时按条数铺骨架', () => {
  const { unmount } = render(<ListPlazaPageSkeleton knownTotal={null} />);
  expect(screen.queryByRole('status', { name: '加载中' })).toBeNull();
  expect(document.querySelector('.ice-spinner')).not.toBeNull();
  unmount();

  render(<ListPlazaPageSkeleton knownTotal={2} />);
  expect(screen.getByRole('status', { name: '加载中' }).children).toHaveLength(
    2,
  );
  expect(document.querySelector('.ice-spinner')).toBeNull();
});

it('进入广场后把服务端总数写入计数 cookie，供下次冷启动的路由 loading 读取', () => {
  render(<ListPlazaPageClient initialTotal={3} />);
  expect(document.cookie).toContain('plaza_count=3');
});
