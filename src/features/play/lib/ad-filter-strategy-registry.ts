export type ServerAdFilterSignal =
  | 'extinf-pattern'
  | 'local-duration-shift'
  | 'host-anomaly'
  | 'periodic-duration-profile'
  | 'short-edge-blocks'
  | 'bitrate-fallback';

export type AdFilterExecution = 'client' | 'server';

export interface SourceAdFilterStrategy {
  id: string;
  version: number;
  execution: AdFilterExecution;
  server?: {
    signals: readonly ServerAdFilterSignal[];
    timeline: 'preserve' | 'continuous-periodic';
  };
}

const SOURCE_AD_FILTER_STRATEGIES: Readonly<
  Record<string, SourceAdFilterStrategy>
> = {
  rycj: {
    id: 'rycj-periodic-blocks',
    version: 3,
    execution: 'server',
    server: {
      signals: [
        'extinf-pattern',
        'local-duration-shift',
        'host-anomaly',
        'periodic-duration-profile',
        'short-edge-blocks',
        'bitrate-fallback',
      ],
      timeline: 'continuous-periodic',
    },
  },
};

export function getSourceAdFilterStrategy(
  sourceKey: string | null | undefined,
): SourceAdFilterStrategy | null {
  const normalized = sourceKey?.trim().toLowerCase();
  if (!normalized) return null;
  return SOURCE_AD_FILTER_STRATEGIES[normalized] || null;
}

export function getRegisteredAdFilterSources(): string[] {
  return Object.keys(SOURCE_AD_FILTER_STRATEGIES);
}

export function shouldFilterAdsOnClient(sourceKey: string): boolean {
  return getSourceAdFilterStrategy(sourceKey)?.execution !== 'server';
}

export function shouldRunServerAdFilter(
  sourceKey: string | null | undefined,
): boolean {
  const strategy = getSourceAdFilterStrategy(sourceKey);
  return strategy?.execution === 'server' && !!strategy.server;
}

export function getAdFilterCacheNamespace(
  sourceKey: string | null | undefined,
): string {
  const normalized = sourceKey?.trim().toLowerCase() || 'unknown';
  const strategy = getSourceAdFilterStrategy(normalized);
  if (!strategy) return `${normalized}:raw@1`;
  return `${normalized}:${strategy.id}@${strategy.version}`;
}
