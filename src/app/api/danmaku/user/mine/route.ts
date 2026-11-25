import { handleMyUserDanmaku } from '@/features/play/lib/danmaku/user-danmaku.server';

export const runtime = 'nodejs';
export const GET = handleMyUserDanmaku;
