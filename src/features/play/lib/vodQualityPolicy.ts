export type VodQualityPolicy = {
  defaultHeight?: number;
  autoStartHeight?: number;
  autoMinHeight?: number;
  autoMaxHeight?: number;
  emergencyBufferSeconds?: number;
  recoveryBufferSeconds?: number;
  allowFailureDowngrade: boolean;
  preserveManualSelectionOnFailure?: boolean;
};

// 未登记的源交给 hls.js 自动码率，只保留失败降档
const DEFAULT_VOD_QUALITY_POLICY: VodQualityPolicy = Object.freeze({
  allowFailureDowngrade: true,
});

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

export function resolveVodQualityPolicy(sourceKey: string): VodQualityPolicy {
  return VOD_QUALITY_POLICIES[sourceKey] || DEFAULT_VOD_QUALITY_POLICY;
}
