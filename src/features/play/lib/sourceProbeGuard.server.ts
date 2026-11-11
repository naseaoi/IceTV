import 'server-only';

import { NextRequest } from 'next/server';

import { SOURCE_PROBE_HEADER } from '@/features/play/lib/sourceProbeRequestPolicy';
import {
  ActiveUserInfo,
  isGuardFailure,
  requireActiveUser,
} from '@/lib/api-auth';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import { withUpstreamResponse } from '@/lib/upstream-resource-guard.server';

export async function withAuthenticatedSourceProbeBudget(
  request: NextRequest,
  handler: (request: NextRequest, auth: ActiveUserInfo) => Promise<Response>,
): Promise<Response> {
  return withSourceProbeBudget(request, async (innerRequest, auth) => {
    const guard = auth ?? (await requireActiveUser(innerRequest));
    if (isGuardFailure(guard)) return guard.response;
    return handler(innerRequest, guard);
  });
}

export async function withSourceProbeBudget(
  request: NextRequest,
  handler: (request: NextRequest, auth?: ActiveUserInfo) => Promise<Response>,
): Promise<Response> {
  if (request.headers.get(SOURCE_PROBE_HEADER) !== '1') return handler(request);

  const guard = await requireActiveUser(request);
  if (isGuardFailure(guard)) return guard.response;

  try {
    return await withUpstreamResponse(
      request.url,
      (signal) =>
        handler(
          new NextRequest(request.url, {
            method: request.method,
            headers: request.headers,
            signal,
          }),
          guard,
        ),
      {
        kind: 'probe',
        identity: `user:${guard.username}`,
        signal: request.signal,
      },
    );
  } catch (error) {
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    throw error;
  }
}
