// localStorage 唯一直接访问点。隐私模式、存储被禁用或配额已满时浏览器会抛 SecurityError / QuotaExceededError，
// 这里统一吞掉异常并降级为「无值」或写入失败，调用方无需各自 try/catch；服务端渲染时同样视为无值

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStorage(key: string): string | null {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** 返回是否写入成功；配额已满时为 false，调用方可清理后重试 */
export function writeStorage(key: string, value: string): boolean {
  const storage = getStorage();
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key: string): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function listStorageKeys(prefix = ''): string[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys;
  } catch {
    return [];
  }
}
