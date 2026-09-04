import { bindDanmakuSettingPersistence } from '@/features/play/lib/danmaku/attach';

type Handler = (...args: never[]) => unknown;

function createPlayerWithHandlers() {
  const handlers = new Map<string, Handler>();
  const player = {
    on(event: never, handler: Handler) {
      handlers.set(String(event), handler);
    },
  };
  return { player, handlers };
}

describe('bindDanmakuSettingPersistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('从关闭切换到开启时持久化并触发一次重载', () => {
    const reload = jest.fn();
    const onEnabledChange = jest.fn();
    const enabledRef = { current: false };
    const { player, handlers } = createPlayerWithHandlers();

    bindDanmakuSettingPersistence(player, {
      enabledRef,
      onEnabledChange,
      onEnable: reload,
    });

    void handlers.get('artplayerPluginDanmuku:show')?.();
    expect(enabledRef.current).toBe(true);
    expect(onEnabledChange).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);

    void handlers.get('artplayerPluginDanmuku:show')?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('关闭时立即持久化关闭状态', () => {
    const enabledRef = { current: true };
    const onEnabledChange = jest.fn();
    const { player, handlers } = createPlayerWithHandlers();

    bindDanmakuSettingPersistence(player, { enabledRef, onEnabledChange });
    void handlers.get('artplayerPluginDanmuku:hide')?.();

    expect(enabledRef.current).toBe(false);
    expect(onEnabledChange).toHaveBeenCalledWith(false);
  });
});
