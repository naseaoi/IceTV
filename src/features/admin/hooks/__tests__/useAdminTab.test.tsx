import { act, renderHook } from '@testing-library/react';

import { useAdminTab } from '@/features/admin/hooks/useAdminTab';
import {
  DEFAULT_ADMIN_TAB,
  getVisibleTabs,
  resolveTabId,
} from '@/features/admin/lib/admin-tabs';

const mockReplace = jest.fn();
const mockParams = new URLSearchParams('tab=reviews');
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/admin',
  useSearchParams: () => mockParams,
}));

describe('review administration tab', () => {
  it.each([false, true])(
    'is visible and directly addressable when owner=%s',
    (isOwner) => {
      expect(getVisibleTabs(isOwner, false)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'reviews', label: '评价管理' }),
        ]),
      );
      const { result } = renderHook(() => useAdminTab(isOwner, false));
      expect(result.current.activeTab).toBe('reviews');
      act(() => result.current.setActiveTab('reviews'));
      expect(mockReplace).toHaveBeenCalledWith('/admin?tab=reviews', {
        scroll: false,
      });
    },
  );
});

describe('traffic tab', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
  ])(
    'owner=%s, monitored=%s shows the tab: %s',
    (isOwner, trafficVisible, expected) => {
      expect(
        getVisibleTabs(isOwner, trafficVisible).some(
          (tab) => tab.id === 'traffic',
        ),
      ).toBe(expected);
      expect(resolveTabId('traffic', isOwner, trafficVisible)).toBe(
        expected ? 'traffic' : DEFAULT_ADMIN_TAB,
      );
    },
  );
});
