'use client';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { markClientHydrated } from '@/lib/client-hydration';
import {
  DEFAULT_RUNTIME_CONFIG,
  getRuntimeConfig,
  RuntimeConfig,
} from '@/lib/runtime-config';

const RuntimeConfigContext = createContext<RuntimeConfig>(
  DEFAULT_RUNTIME_CONFIG,
);

export function RuntimeConfigProvider({
  children,
  initialConfig,
}: {
  children: ReactNode;
  initialConfig: RuntimeConfig;
}) {
  const [runtimeConfig, setRuntimeConfig] =
    useState<RuntimeConfig>(initialConfig);

  useEffect(() => {
    markClientHydrated();

    const currentConfig = getRuntimeConfig();
    if (currentConfig) {
      setRuntimeConfig(currentConfig);
    }

    const handleRuntimeConfigUpdated = (event: Event) => {
      const nextConfig = (event as CustomEvent<RuntimeConfig>).detail;
      if (nextConfig) {
        setRuntimeConfig(nextConfig);
      }
    };

    window.addEventListener(
      'runtime-config-updated',
      handleRuntimeConfigUpdated,
    );

    return () => {
      window.removeEventListener(
        'runtime-config-updated',
        handleRuntimeConfigUpdated,
      );
    };
  }, []);

  const value = useMemo(() => runtimeConfig, [runtimeConfig]);

  return (
    <RuntimeConfigContext.Provider value={value}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig() {
  return useContext(RuntimeConfigContext);
}
