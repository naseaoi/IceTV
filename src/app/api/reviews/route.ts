import { handleOwnReview } from '@/lib/video-reviews.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleOwnReview;
export const PUT = handleOwnReview;
export const DELETE = handleOwnReview;
