import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { requireActiveUser } from '@/lib/api-auth';
import { ResourceLimitError } from '@/lib/server-resource-errors';
import { withUpstreamResponse } from '@/lib/upstream-resource-guard.server';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: (result: object) => 'response' in result,
}));
jest.mock('@/lib/upstream-resource-guard.server', () => ({
  withUpstreamResponse: jest.fn(),
}));
installStreamPolyfills();
const { NextRequest } = require('next/server') as typeof import('next/server');
const { withSourceProbeBudget } =
  require('@/features/play/lib/sourceProbeGuard.server') as typeof import('@/features/play/lib/sourceProbeGuard.server');

describe('source probe route budget', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (requireActiveUser as jest.Mock).mockResolvedValue({ username: 'viewer' });
    (withUpstreamResponse as jest.Mock).mockImplementation((_url, loader) =>
      loader(new AbortController().signal),
    );
  });

  it('keeps ordinary playback outside the probe budget', async () => {
    const request = new NextRequest('http://localhost/api/proxy/segment');
    const response = new Response('media');
    const handler = jest.fn().mockResolvedValue(response);
    expect(await withSourceProbeBudget(request, handler)).toBe(response);
    expect(handler).toHaveBeenCalledWith(request);
    expect(requireActiveUser).not.toHaveBeenCalled();
    expect(withUpstreamResponse).not.toHaveBeenCalled();
  });

  it('uses the authenticated identity and forwards the budget abort signal', async () => {
    const request = new NextRequest('http://localhost/api/detail', {
      headers: { 'X-IceTV-Probe': '1' },
    });
    const handler = jest.fn().mockResolvedValue(new Response('detail'));
    await withSourceProbeBudget(request, handler);
    expect(withUpstreamResponse).toHaveBeenCalledWith(
      request.url,
      expect.any(Function),
      {
        kind: 'probe',
        identity: 'user:viewer',
        signal: request.signal,
      },
    );
    expect(handler.mock.calls[0][0].headers.get('X-IceTV-Probe')).toBe('1');
    expect(handler.mock.calls[0][0].signal).toBeDefined();
  });

  it('rejects unauthenticated probes before acquiring resources', async () => {
    (requireActiveUser as jest.Mock).mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    const handler = jest.fn();
    const response = await withSourceProbeBudget(
      new NextRequest('http://localhost/api/detail', {
        headers: { 'X-IceTV-Probe': '1' },
      }),
      handler,
    );
    expect(response.status).toBe(401);
    expect(withUpstreamResponse).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts Next.js request proxies without reading private Request internals', async () => {
    const original = new NextRequest('http://localhost/api/detail', {
      headers: { 'X-IceTV-Probe': '1' },
    });
    const request = new Proxy(original, {
      get(target, property) {
        if (
          !['url', 'method', 'headers', 'signal'].includes(String(property))
        ) {
          throw new Error(
            'private Request state is inaccessible through a proxy',
          );
        }
        return Reflect.get(target, property, target);
      },
    });
    const controller = new AbortController();
    (withUpstreamResponse as jest.Mock).mockImplementation((_url, loader) =>
      loader(controller.signal),
    );
    const handler = jest.fn().mockResolvedValue(new Response('detail'));
    await expect(
      withSourceProbeBudget(request, handler),
    ).resolves.toBeInstanceOf(Response);
    const forwardedRequest = handler.mock.calls[0][0];
    expect(forwardedRequest.url).toBe(original.url);
    expect(forwardedRequest.headers.get('X-IceTV-Probe')).toBe('1');
    controller.abort();
    expect(forwardedRequest.signal.aborted).toBe(true);
  });

  it('reports busy admission without invoking the upstream handler', async () => {
    (withUpstreamResponse as jest.Mock).mockRejectedValue(
      new ResourceLimitError(503, 2),
    );
    const handler = jest.fn();
    const response = await withSourceProbeBudget(
      new NextRequest('http://localhost/api/detail', {
        headers: { 'X-IceTV-Probe': '1' },
      }),
      handler,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('2');
    expect(handler).not.toHaveBeenCalled();
  });
});
