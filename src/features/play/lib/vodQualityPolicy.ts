export type VodQualityPolicy = {
  defaultHeight: number;
  autoStartHeight: number;
  autoMinHeight?: number;
  autoMaxHeight?: number;
  emergencyBufferSeconds?: number;
  recoveryBufferSeconds?: number;
  allowFailureDowngrade: boolean;
  preserveManualSelectionOnFailure?: boolean;
};

const VOD_QUALITY_POLICIES: Readonly<Record<string, VodQualityPolicy>> = {
  xigua: {
    defaultHeight: 720,
    autoStartHeight: 720,
    autoMinHeight: 480,
    autoMaxHeight: 720,
    emergencyBufferSeconds: 6,
    recoveryBufferSeconds: 25,
    allowFailureDowngrade: true,
    preserveManualSelectionOnFailure: true,
  },
};

export function resolveVodQualityPolicy(
  sourceKey: string,
): VodQualityPolicy | null {
  return VOD_QUALITY_POLICIES[sourceKey] || null;
}
