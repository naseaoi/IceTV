import { act, renderHook } from '@testing-library/react';

import { useAdminTab } from '@/features/admin/hooks/useAdminTab';
import { getVisibleTabs } from '@/features/admin/lib/admin-tabs';

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
      expect(getVisibleTabs(isOwner)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'reviews', label: '评价管理' }),
        ]),
      );
      const { result } = renderHook(() => useAdminTab(isOwner));
      expect(result.current.activeTab).toBe('reviews');
      act(() => result.current.setActiveTab('reviews'));
      expect(mockReplace).toHaveBeenCalledWith('/admin?tab=reviews', {
        scroll: false,
      });
    },
  );
});
