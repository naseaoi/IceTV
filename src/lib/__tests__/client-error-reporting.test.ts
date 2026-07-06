import {
  buildClientErrorReport,
  reportClientError,
} from '@/lib/client-error-reporting';

describe('client error reporting', () => {
  it('builds a readable report for Error objects', () => {
    const error = new Error('boom') as Error & { digest?: string };
    error.digest = 'digest-id';

    const report = buildClientErrorReport('页面渲染失败', error, {
      route: '/play',
      ignored: undefined,
    });

    expect(report).toMatchObject({
      context: '页面渲染失败',
      message: 'boom',
      name: 'Error',
      digest: 'digest-id',
      metadata: {
        route: '/play',
      },
    });
    expect(report.stack).toContain('boom');
  });

  it('logs a structured browser console message', () => {
    const logger = {
      error: jest.fn(),
    };

    const report = reportClientError({
      context: '浏览器运行时错误',
      error: 'failed',
      logger,
    });

    expect(report.message).toBe('failed');
    expect(logger.error).toHaveBeenCalledWith(
      '[IceTV] 浏览器运行时错误: failed',
      expect.objectContaining({
        context: '浏览器运行时错误',
        message: 'failed',
      }),
    );
  });
});
