'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { type AdminTabId, resolveTabId } from '@/features/admin/lib/admin-tabs';

const TAB_PARAM = 'tab';

export function useAdminTab(isOwnerRole: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeTab = useMemo(
    () => resolveTabId(searchParams.get(TAB_PARAM), isOwnerRole),
    [searchParams, isOwnerRole],
  );

  const setActiveTab = useCallback(
    (tab: AdminTabId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(TAB_PARAM, tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return { activeTab, setActiveTab };
}
