import type { WakeLockSentinel } from '@/features/play/lib/playTypes';

type WakeLockRef = { current: WakeLockSentinel | null };

type WakeLockApi = {
  request: (type: 'screen') => Promise<WakeLockSentinel>;
};

function getWakeLockApi(): WakeLockApi | null {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return null;
  }
  return (navigator as unknown as { wakeLock: WakeLockApi }).wakeLock;
}

function isPageVisible() {
  return (
    typeof document === 'undefined' || document.visibilityState === 'visible'
  );
}

/**
 * 同一时刻最多持有一个屏幕常亮锁。
 * play 事件不保证与 pause 成对（换集时 video.load() 静默暂停），请求必须幂等；
 * 请求在途期间若已释放，到手的锁立即归还，否则暂停后屏幕仍常亮。
 */
export function createScreenWakeLockController(ref: WakeLockRef) {
  let wanted = false;
  let pending: Promise<void> | null = null;

  const isHeld = () => !!ref.current && !ref.current.released;

  const request = async () => {
    wanted = true;
    if (isHeld() || pending) return pending ?? undefined;
    if (!isPageVisible()) return;
    const api = getWakeLockApi();
    if (!api) return;

    pending = (async () => {
      try {
        const sentinel = await api.request('screen');
        if (!wanted || !isPageVisible()) {
          await sentinel.release().catch(() => undefined);
          return;
        }
        ref.current = sentinel;
        // 页面隐藏时浏览器会自动释放，清掉引用让回到前台时能重新申请
        sentinel.addEventListener('release', () => {
          if (ref.current === sentinel) ref.current = null;
        });
      } catch (err) {
        if (
          err instanceof DOMException &&
          err.name === 'NotAllowedError' &&
          !isPageVisible()
        ) {
          return;
        }
        console.warn('Wake Lock 请求失败:', err);
      } finally {
        pending = null;
      }
    })();
    return pending;
  };

  const release = async () => {
    wanted = false;
    const sentinel = ref.current;
    ref.current = null;
    if (!sentinel || sentinel.released) return;
    try {
      await sentinel.release();
    } catch (err) {
      console.warn('Wake Lock 释放失败:', err);
    }
  };

  return { request, release };
}
