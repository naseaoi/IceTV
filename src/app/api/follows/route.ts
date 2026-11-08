import { handleFollows } from '@/lib/user-profile.server';

export const runtime = 'nodejs';
export const PUT = handleFollows;
export const DELETE = handleFollows;
