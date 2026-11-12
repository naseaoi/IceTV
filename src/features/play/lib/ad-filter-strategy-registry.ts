export type AdFilterSignal =
  | 'extinf-pattern'
  | 'local-duration-shift'
  | 'host-anomaly'
  | 'periodic-duration-profile'
  | 'short-edge-blocks';

export interface SourceAdFilterStrategy {
  id: string;
  signals: readonly AdFilterSignal[];
  timeline: 'preserve' | 'continuous-periodic';
}

const SOURCE_AD_FILTER_STRATEGIES: Readonly<
  Record<string, SourceAdFilterStrategy>
> = {
  rycj: {
    id: 'rycj-periodic-blocks',
    signals: [
      'extinf-pattern',
      'local-duration-shift',
      'host-anomaly',
      'periodic-duration-profile',
      'short-edge-blocks',
    ],
    timeline: 'continuous-periodic',
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
