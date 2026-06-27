import {
  isAbortLikeHlsError,
  logHlsError,
  resetHlsErrorLogState,
} from '@/lib/hls-error-log';

describe('hls error log', () => {
  beforeEach(() => {
    resetHlsErrorLogState();
  });

  it('downgrades expected abort errors to debug', () => {
    const logger = {
      error: jest.fn(),
      debug: jest.fn(),
    };

    const result = logHlsError(
      'event',
      {
        type: 'networkError',
        details: 'fragLoadError',
        error: { message: 'net::ERR_ABORTED' },
      },
      {
        scope: 'vod',
        sourceKey: 'source-a-id',
        expectedAbort: true,
        logger,
        now: 1_000,
      },
    );

    expect(result.level).toBe('debug');
    expect(result.expectedAbort).toBe(true);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('merges repeated hls errors in a short window', () => {
    const logger = {
      error: jest.fn(),
      debug: jest.fn(),
    };
    const data = {
      type: 'networkError',
      details: 'fragLoadError',
      fatal: true,
      response: { code: 500 },
    };

    const first = logHlsError('event', data, {
      scope: 'vod',
      sourceKey: 'source-a-id',
      logger,
      now: 1_000,
    });
    const second = logHlsError('event', data, {
      scope: 'vod',
      sourceKey: 'source-a-id',
      logger,
      now: 2_000,
    });
    const third = logHlsError('event', data, {
      scope: 'vod',
      sourceKey: 'source-a-id',
      logger,
      now: 12_000,
    });

    expect(first.logged).toBe(true);
    expect(second.logged).toBe(false);
    expect(third.logged).toBe(true);
    expect(third.suppressedCount).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('downgrades recoverable hls errors to debug', () => {
    const logger = {
      error: jest.fn(),
      debug: jest.fn(),
    };

    const result = logHlsError(
      'event',
      {
        type: 'networkError',
        details: 'fragLoadError',
        fatal: false,
      },
      {
        scope: 'vod',
        sourceKey: 'source-a-id',
        logger,
        now: 1_000,
      },
    );

    expect(result.level).toBe('debug');
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('detects abort-like hls payloads', () => {
    expect(
      isAbortLikeHlsError({
        error: { name: 'AbortError' },
      }),
    ).toBe(true);
  });
});
