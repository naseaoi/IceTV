import { handleReviewReplies } from '@/lib/review-replies.server';

export const runtime = 'nodejs';
export const GET = handleReviewReplies;
export const POST = handleReviewReplies;
export const DELETE = handleReviewReplies;
