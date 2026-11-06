import { handleAdminUserDanmaku } from '@/features/play/lib/danmaku/user-danmaku.server';

export const runtime = 'nodejs';
export const GET = handleAdminUserDanmaku;
export const DELETE = handleAdminUserDanmaku;
