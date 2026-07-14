export type VodQualityPolicy = {
  defaultHeight: number;
  autoStartHeight: number;
  allowFailureDowngrade: boolean;
};

const VOD_QUALITY_POLICIES: Readonly<Record<string, VodQualityPolicy>> = {
  xigua: {
    defaultHeight: 720,
    autoStartHeight: 720,
    allowFailureDowngrade: true,
  },
};

export function resolveVodQualityPolicy(
  sourceKey: string,
): VodQualityPolicy | null {
  return VOD_QUALITY_POLICIES[sourceKey] || null;
}
