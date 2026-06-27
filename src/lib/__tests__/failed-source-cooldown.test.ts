import {
  clearSourceFailure,
  getSourceFailure,
  markSourceFailed,
} from '@/lib/failed-source-cooldown';

const STORAGE_KEY = 'icetv_failed_sources';
const COOLDOWN_MS = 5 * 60 * 1000;

describe('failed source cooldown', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    jest.restoreAllMocks();
  });

  it('reads legacy timestamp records', () => {
    jest.spyOn(Date, 'now').mockReturnValue(2_000);
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ a: 1_000 }));

    const failure = getSourceFailure('a');

    expect(failure.coolingDown).toBe(true);
    expect(failure.count).toBe(1);
    expect(failure.label).toBe('近期失败');
  });

  it('increments failure count and exposes readable labels', () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);

    markSourceFailed('source-a-id', {
      reason: 'connection-closed',
      message: 'net::ERR_CONNECTION_CLOSED',
    });
    markSourceFailed('source-a-id', {
      reason: 'proxy-500',
      status: 500,
    });

    const failure = getSourceFailure('source-a-id');

    expect(failure.coolingDown).toBe(true);
    expect(failure.count).toBe(2);
    expect(failure.label).toBe('代理 500');
  });

  it('expires and clears failure records', () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    markSourceFailed('source-a-id', { reason: 'timeout' });

    jest.spyOn(Date, 'now').mockReturnValue(10_000 + COOLDOWN_MS + 1);

    expect(getSourceFailure('source-a-id').coolingDown).toBe(false);
    clearSourceFailure('source-a-id');
    expect(getSourceFailure('source-a-id').coolingDown).toBe(false);
  });
});
