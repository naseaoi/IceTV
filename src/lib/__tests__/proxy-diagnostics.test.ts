import {
  classifyProxyFailure,
  sanitizeProxyLogUrl,
} from '@/lib/proxy-diagnostics';

describe('proxy diagnostics', () => {
  it('redacts target query values for logs', () => {
    const sanitized = sanitizeProxyLogUrl(
      'https://example.com/a/b.m3u8?token=abc&plain=value',
    );

    expect(sanitized).toBe(
      'https://example.com/a/b.m3u8?token=%3Credacted%3E&plain=%3Credacted%3E',
    );
  });

  it('classifies proxy status failures', () => {
    const diagnostic = classifyProxyFailure(new Error('代理请求失败: 502'), {
      route: 'm3u8',
      stage: 'proxy',
      reason: 'proxy-response',
      status: 500,
    });

    expect(diagnostic.stage).toBe('proxy');
    expect(diagnostic.reason).toBe('proxy-http');
    expect(diagnostic.status).toBe(502);
    expect(diagnostic.upstreamStatus).toBe(502);
  });
});
