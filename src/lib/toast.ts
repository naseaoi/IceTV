export type ToastTone = 'success' | 'error' | 'info' | 'notice';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  // 毫秒；未传时按语气取默认值
  duration?: number;
  // 相同 key 的提示原地更新而非叠加，默认取语气 + 文案
  key?: string;
}

export interface ToastDetail extends Omit<ToastOptions, 'key'> {
  key: string;
  message: string;
  tone: ToastTone;
}

export const TOAST_EVENT = 'app-toast';
export const TOAST_DISMISS_EVENT = 'app-toast-dismiss';

export function showToast(
  message: string,
  tone: ToastTone = 'info',
  options: ToastOptions = {},
) {
  if (typeof window === 'undefined') return;
  const { key = `${tone}:${message}`, ...rest } = options;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, {
      detail: { ...rest, key, message, tone },
    }),
  );
}

export function dismissToast(key: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<string>(TOAST_DISMISS_EVENT, { detail: key }),
  );
}
