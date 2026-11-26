import {
  type ProxyFailureInput,
  classifyProxyFailure,
  createProxyFailureDiagnostic,
  sanitizeProxyLogUrl,
  toSourceProxyFailureReason,
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

describe('source proxy failure reasons', () => {
  const diagnostic = (input: Partial<ProxyFailureInput> = {}) =>
    createProxyFailureDiagnostic({
      route: 'm3u8',
      source: 'a',
      stage: 'upstream',
      reason: 'upstream-fetch',
      ...input,
    });
  it.each([
    [403, 'http-403'],
    [404, 'http-404'],
    [410, 'http-404'],
    [400, 'http-4xx'],
    [429, 'http-4xx'],
    [500, 'http-5xx'],
    [599, 'http-5xx'],
    [200, null],
    [302, null],
    [undefined, null],
  ])('maps upstream HTTP %s to %s', (upstreamStatus, expected) => {
    expect(
      toSourceProxyFailureReason(
        diagnostic({
          reason: 'upstream-http',
          upstreamStatus: upstreamStatus as number | undefined,
        }),
      ),
    ).toBe(expected);
  });
  it.each<[ProxyFailureInput['reason'], string | null]>([
    ['upstream-timeout', 'timeout'],
    ['proxy-timeout', 'timeout'],
    ['upstream-fetch', 'connection'],
    ['proxy-connect', 'connection'],
    ['proxy-http', 'connection'],
    ['proxy-response', 'connection'],
    ['content-type', 'invalid-response'],
    ['response-too-large', 'invalid-response'],
    ['proxy-response-too-large', 'invalid-response'],
    ['missing-url', null],
    ['invalid-url', null],
    ['auth-failed', null],
    ['upstream-abort', null],
    ['internal', null],
  ])('maps %s to %s', (reason, expected) => {
    expect(toSourceProxyFailureReason(diagnostic({ reason }))).toBe(expected);
  });
  it.each<Partial<ProxyFailureInput>>([
    { source: undefined },
    { source: '' },
    { source: '  ' },
    { isLive: true },
    { stage: 'request' },
    { stage: 'validation' },
    { stage: 'auth' },
    { stage: 'internal' },
  ])('excludes non-source failures: %j', (input) => {
    expect(toSourceProxyFailureReason(diagnostic(input))).toBeNull();
  });
});
