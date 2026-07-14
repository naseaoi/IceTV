import { resolveHlsBufferDefaults } from '@/lib/hls-buffer-policy';

describe('HLS buffer policy', () => {
  it('uses a 120 second forward buffer on desktop devices', () => {
    expect(
      resolveHlsBufferDefaults({
        deviceMemory: 8,
        effectiveType: '4g',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      }),
    ).toEqual({
      maxBufferLength: 120,
      maxMaxBufferLength: 600,
      backBufferLength: 120,
      maxBufferSize: 120 * 1000 * 1000,
    });
  });

  it('uses a 60 second forward buffer on mobile and low-memory devices', () => {
    expect(
      resolveHlsBufferDefaults({
        deviceMemory: 4,
        effectiveType: '4g',
        userAgent: 'Mozilla/5.0 (Linux; Android 15)',
      }),
    ).toEqual({
      maxBufferLength: 60,
      maxMaxBufferLength: 180,
      backBufferLength: 60,
      maxBufferSize: 60 * 1000 * 1000,
    });
  });

  it('uses a 30 second forward buffer for data saving and slow networks', () => {
    expect(
      resolveHlsBufferDefaults({
        saveData: true,
        deviceMemory: 8,
        effectiveType: '4g',
      }).maxBufferLength,
    ).toBe(30);
    expect(
      resolveHlsBufferDefaults({
        deviceMemory: 8,
        effectiveType: '3g',
      }).maxBufferLength,
    ).toBe(30);
  });
});
