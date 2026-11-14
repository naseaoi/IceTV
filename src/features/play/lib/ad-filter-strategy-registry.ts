export type AdFilterSignal =
  | 'known-ad-templates'
  | 'frame-grid-clips'
  | 'host-anomaly';

export interface SourceAdFilterStrategy {
  id: string;
  signals: readonly AdFilterSignal[];
  /** 已确认广告素材的整块 EXTINF 序列；同一素材跨集、跨作品、跨 CDN 字节一致，只有文件名随机 */
  adTemplates: readonly (readonly number[])[];
  timeline: 'preserve' | 'continuous-periodic';
}

const SOURCE_AD_FILTER_STRATEGIES: Readonly<
  Record<string, SourceAdFilterStrategy>
> = {
  rycj: {
    id: 'rycj-periodic-blocks',
    signals: ['known-ad-templates', 'frame-grid-clips', 'host-anomaly'],
    adTemplates: [
      [4, 5.48, 2.68],
      [4, 4, 4, 4, 3.88],
      [4, 4, 4, 4, 3],
      [4, 4, 4, 4, 4, 1],
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
