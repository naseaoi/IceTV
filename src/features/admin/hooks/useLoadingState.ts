'use client';

import { useCallback, useState } from 'react';

type LoadingState = Record<string, boolean>;

export function useLoadingState() {
  const [loadingStates, setLoadingStates] = useState<LoadingState>({});

  const setLoading = useCallback((key: string, loading: boolean) => {
    setLoadingStates((prev) => ({ ...prev, [key]: loading }));
  }, []);

  const isLoading = useCallback(
    (key: string) => loadingStates[key] || false,
    [loadingStates],
  );

  const withLoading = useCallback(
    async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
      setLoading(key, true);
      try {
        return await operation();
      } finally {
        setLoading(key, false);
      }
    },
    [setLoading],
  );

  return { loadingStates, setLoading, isLoading, withLoading };
}
