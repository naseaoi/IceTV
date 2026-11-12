import { NextRequest, NextResponse } from 'next/server';

import { isSecureRequest } from '@/lib/auth.server';
import { clearListCountCookiesOnResponse } from '@/lib/list-count-cookies';

export const runtime = 'nodejs';

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

  clearListCountCookiesOnResponse(response);

  return response;
}
