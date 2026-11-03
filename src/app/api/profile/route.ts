import { handleProfile } from '@/lib/user-profile.server';

export const runtime = 'nodejs';
export const GET = handleProfile;
export const PUT = handleProfile;
