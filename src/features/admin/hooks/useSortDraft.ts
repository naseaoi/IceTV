import { useCallback, useMemo, useState } from 'react';

import { useReportDirty } from './useReportDirty';

// 拖动排序的本地草稿：只记 key 顺序，按服务端最新列表合并出展示列表。
// 配置刷新时保留本地顺序（删除的项移除、新增的项追加）；是否未保存由合并结果与服务端顺序比较得出，
// 拖回原序或删到一致时自动复位。未保存状态经 onOrderDirtyChange 上报后台页，卸载时复位。
export function useSortDraft<T>(
  remote: T[],
  getKey: (item: T) => string,
  onOrderDirtyChange?: (dirty: boolean) => void,
) {
  const [order, setOrder] = useState<string[] | null>(null);

  const items = useMemo(() => {
    if (!order) return remote;
    const byKey = new Map(remote.map((item) => [getKey(item), item]));
    const ordered = new Set(order);
    return [
      ...order.flatMap((key) => {
        const item = byKey.get(key);
        return item === undefined ? [] : [item];
      }),
      ...remote.filter((item) => !ordered.has(getKey(item))),
    ];
  }, [order, remote, getKey]);

  const orderChanged = items.some(
    (item, index) => getKey(item) !== getKey(remote[index]),
  );

  useReportDirty(orderChanged, onOrderDirtyChange);

  const resetOrder = useCallback(() => setOrder(null), []);

  return { items, orderChanged, setOrder, resetOrder };
}
