import { handleUserDanmaku } from '@/features/play/lib/danmaku/user-danmaku.server';

export const runtime = 'nodejs';
export const GET = handleUserDanmaku;
export const POST = handleUserDanmaku;
export const DELETE = handleUserDanmaku;
