import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function isSecureRequest(req: NextRequest): boolean {
  return (
    req.nextUrl.protocol === 'https:' ||
    req.headers.get('x-forwarded-proto') === 'https'
  );
}

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const secure = isSecureRequest(req);

  // 清除认证cookie（服务端鉴权）
  response.cookies.set('auth', '', {
    path: '/',
    expires: new Date(0),
    sameSite: 'lax',
    httpOnly: true,
    secure,
  });

  // 清除展示用cookie（客户端可读取）
  response.cookies.set('auth_meta', '', {
    path: '/',
    expires: new Date(0),
    sameSite: 'lax',
    httpOnly: false,
    secure,
  });

  return response;
}
