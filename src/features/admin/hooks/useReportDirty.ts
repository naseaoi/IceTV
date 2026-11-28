import { useEffect } from 'react';

export function useReportDirty(
  dirty: boolean,
  onDirtyChange?: (dirty: boolean) => void,
) {
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
}
