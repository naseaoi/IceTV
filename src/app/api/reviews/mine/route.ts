import { handleMyReviews } from '@/lib/video-reviews.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleMyReviews;
