import { resolveVodQualityPolicy } from '@/features/play/lib/vodQualityPolicy';

describe('VOD quality policy', () => {
  it('configures xigua quality behavior', () => {
    expect(resolveVodQualityPolicy('xigua')).toEqual({
      defaultHeight: 720,
      autoStartHeight: 720,
      allowFailureDowngrade: true,
    });
  });

  it('leaves sources without a profile on native HLS behavior', () => {
    expect(resolveVodQualityPolicy('other')).toBeNull();
  });
});
