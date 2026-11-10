import { handleAnnualShare } from '@/features/playback-stats/lib/annual-share.server';

export const runtime = 'nodejs';
export const GET = handleAnnualShare;
export const PUT = handleAnnualShare;
export const DELETE = handleAnnualShare;
