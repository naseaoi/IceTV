import { handleWorkReviews } from '@/lib/video-reviews.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleWorkReviews;
