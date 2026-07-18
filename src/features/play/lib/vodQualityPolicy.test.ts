import { resolveVodQualityPolicy } from '@/features/play/lib/vodQualityPolicy';

describe('VOD quality policy', () => {
  it('configures xigua quality behavior', () => {
    expect(resolveVodQualityPolicy('xigua')).toEqual({
      defaultHeight: 720,
      autoStartHeight: 720,
      autoMinHeight: 480,
      autoMaxHeight: 720,
      emergencyBufferSeconds: 6,
      recoveryBufferSeconds: 25,
      allowFailureDowngrade: true,
      preserveManualSelectionOnFailure: true,
    });
  });

  it('leaves sources without a profile on native HLS behavior', () => {
    expect(resolveVodQualityPolicy('other')).toBeNull();
  });
});
