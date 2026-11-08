import { handleAdminReviewReports } from '@/lib/review-reactions.server';

export const runtime = 'nodejs';
export const GET = handleAdminReviewReports;
export const POST = handleAdminReviewReports;
