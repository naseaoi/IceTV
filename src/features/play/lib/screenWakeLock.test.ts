import type { WakeLockSentinel } from '@/features/play/lib/playTypes';
import { createScreenWakeLockController } from '@/features/play/lib/screenWakeLock';

function createSentinel() {
  const listeners = new Set<() => void>();
  const sentinel = {
    released: false,
    release: jest.fn(async () => {
      sentinel.released = true;
      listeners.forEach((listener) => listener());
    }),
    addEventListener: (_: 'release', listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: 'release', listener: () => void) =>
      listeners.delete(listener),
  };
  return sentinel;
}

describe('createScreenWakeLockController', () => {
  let request: jest.Mock;

  beforeEach(() => {
    request = jest.fn(async () => createSentinel());
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    });
  });

  afterEach(() => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  });

  it('重复申请只持有一个锁，释放后屏幕不再常亮', async () => {
    const ref = { current: null as WakeLockSentinel | null };
    const controller = createScreenWakeLockController(ref);

    await Promise.all([controller.request(), controller.request()]);
    await controller.request();
    expect(request).toHaveBeenCalledTimes(1);

    const held = ref.current as ReturnType<typeof createSentinel>;
    await controller.release();
    expect(held.release).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });

  it('申请在途时已释放，到手的锁立即归还', async () => {
    let resolveRequest: (value: WakeLockSentinel) => void = () => undefined;
    request.mockImplementationOnce(
      () =>
        new Promise<WakeLockSentinel>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const ref = { current: null as WakeLockSentinel | null };
    const controller = createScreenWakeLockController(ref);

    const pending = controller.request();
    await controller.release();
    const late = createSentinel();
    resolveRequest(late);
    await pending;

    expect(late.release).toHaveBeenCalledTimes(1);
    expect(ref.current).toBeNull();
  });

  it('浏览器自动释放后可以重新申请', async () => {
    const ref = { current: null as WakeLockSentinel | null };
    const controller = createScreenWakeLockController(ref);

    await controller.request();
    await (ref.current as WakeLockSentinel).release();
    expect(ref.current).toBeNull();

    await controller.request();
    expect(request).toHaveBeenCalledTimes(2);
    expect(ref.current).not.toBeNull();
  });
});
