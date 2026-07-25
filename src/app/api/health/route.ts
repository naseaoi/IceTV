export const dynamic = 'force-static';

function createHealthResponse() {
  return new Response('ok', {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

export function GET() {
  return createHealthResponse();
}

export function HEAD() {
  return createHealthResponse();
}
