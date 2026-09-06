import 'server-only';

import { withUpstreamResponse } from '@/lib/upstream-resource-guard.server';
import { fetchWithUrlGuard } from '@/lib/url-guard';

export async function fetchUpstream(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetchWithUrlGuard(url, init);
  if (!response.ok) await response.body?.cancel();
  return response;
}

export async function fetchPrivateUpstream(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let target = url;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await withUpstreamResponse(
      target,
      (signal) => fetch(target, { ...init, redirect: 'manual', signal }),
      { signal: init.signal },
    );
    const location = response.headers.get('location');
    if (
      ![301, 302, 303, 307, 308].includes(response.status) ||
      !location ||
      init.redirect === 'manual'
    )
      return response;
    await response.body?.cancel();
    if (init.redirect === 'error') throw new Error('Redirect not allowed');
    const next = new URL(location, target);
    if (!['http:', 'https:'].includes(next.protocol))
      throw new Error('Invalid redirect protocol');
    target = next.toString();
  }
  throw new Error('Too many redirects');
}
