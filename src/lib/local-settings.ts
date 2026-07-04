export const AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY =
  'autoSwitchSourceOnTimeout';

export const LOCAL_SETTING_CHANGED_EVENT = 'icetv:local-setting-changed';

interface LocalSettingChangedDetail {
  key: string;
  value?: boolean;
}

export function readBooleanLocalSetting(
  key: string,
  defaultValue: boolean,
): boolean {
  if (typeof window === 'undefined') {
    return defaultValue;
  }

  const saved = window.localStorage.getItem(key);
  if (saved === null) {
    return defaultValue;
  }

  try {
    return JSON.parse(saved);
  } catch {
    return defaultValue;
  }
}

export function readDefaultAutoSwitchSourceOnTimeout(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.RUNTIME_CONFIG?.AUTO_SWITCH_SOURCE_ON_TIMEOUT === true;
}

export function writeBooleanLocalSetting(key: string, value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(
    new CustomEvent<LocalSettingChangedDetail>(LOCAL_SETTING_CHANGED_EVENT, {
      detail: { key, value },
    }),
  );
}

export function removeBooleanLocalSetting(key: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(key);
  window.dispatchEvent(
    new CustomEvent<LocalSettingChangedDetail>(LOCAL_SETTING_CHANGED_EVENT, {
      detail: { key },
    }),
  );
}
