type AdminList = 'reviews' | 'danmaku';

// 接口只返回游标：记录无筛选首页的条数，而非将已加载的多页当成总数。
const firstPageCounts: Partial<Record<AdminList, number>> = {};

export function getKnownAdminListCount(list: AdminList): number | undefined {
  return firstPageCounts[list];
}

export function rememberAdminListCount(
  list: AdminList,
  count: number | undefined,
) {
  firstPageCounts[list] = count;
}
