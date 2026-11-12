import { handlePublicAnnualRecap } from '@/features/playback-stats/lib/annual-share.server';

export const runtime = 'nodejs';
export const GET = handlePublicAnnualRecap;
