import { useEffect, useState } from 'react';

import {
  AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY,
  LOCAL_SETTING_CHANGED_EVENT,
  readBooleanLocalSetting,
  readDefaultAutoSwitchSourceOnTimeout,
} from '@/lib/local-settings';

export function useAutoSwitchOnTimeoutSetting(): boolean {
  const [autoSwitchSourceOnTimeout, setAutoSwitchSourceOnTimeout] =
    useState<boolean>(() =>
      readBooleanLocalSetting(
        AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY,
        readDefaultAutoSwitchSourceOnTimeout(),
      ),
    );

  useEffect(() => {
    const syncAutoSwitchSetting = () => {
      setAutoSwitchSourceOnTimeout(
        readBooleanLocalSetting(
          AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY,
          readDefaultAutoSwitchSourceOnTimeout(),
        ),
      );
    };

    const handleLocalSettingChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key !== AUTO_SWITCH_SOURCE_ON_TIMEOUT_STORAGE_KEY) {
        return;
      }
      syncAutoSwitchSetting();
    };

    window.addEventListener('storage', syncAutoSwitchSetting);
    window.addEventListener(
      LOCAL_SETTING_CHANGED_EVENT,
      handleLocalSettingChanged,
    );

    return () => {
      window.removeEventListener('storage', syncAutoSwitchSetting);
      window.removeEventListener(
        LOCAL_SETTING_CHANGED_EVENT,
        handleLocalSettingChanged,
      );
    };
  }, []);

  return autoSwitchSourceOnTimeout;
}
