import { handleNicknameAvailability } from '@/lib/user-profile.server';

export const runtime = 'nodejs';
export const GET = handleNicknameAvailability;
