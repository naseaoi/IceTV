import { NextResponse } from 'next/server';

import { ConfigConflictError } from '@/lib/config';

export function configConflictResponse(error: unknown): NextResponse | null {
  if (error instanceof ConfigConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return null;
}
