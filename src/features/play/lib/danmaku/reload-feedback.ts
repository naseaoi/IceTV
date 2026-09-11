import {
  type DanmakuReloadResult,
  DanmakuRateLimitError,
} from '@/features/play/lib/danmaku/types';

export function getDanmakuReloadFeedback(result: DanmakuReloadResult | void) {
  switch (result?.status) {
    case 'loaded':
      return {
        message: `弹幕重载成功，已装载 ${result.count} 条弹幕`,
        failed: false,
      };
    case 'empty':
      return { message: '弹幕重载完成，当前暂无弹幕', failed: false };
    case 'disabled':
      return { message: '弹幕已关闭，请先开启弹幕后重载', failed: false };
    case 'unavailable':
      return { message: '弹幕播放器尚未就绪，请稍后重试', failed: true };
    case 'superseded':
      return { message: '弹幕加载任务已切换，请查看当前弹幕', failed: false };
    case 'rate-limited':
      return {
        message: new DanmakuRateLimitError(result.retryAfterSeconds).message,
        failed: true,
      };
    case 'error':
      return { message: '弹幕重载失败，请稍后重试', failed: true };
    default:
      return { message: '弹幕重载完成', failed: false };
  }
}
