const STORAGE_KEY = 'icetv_failed_sources';
const COOLDOWN_MS = 5 * 60 * 1000;
const MAX_FAILURE_TEXT_LENGTH = 80;

export interface SourceFailureMarkOptions {
  reason?: string;
  message?: string;
  stage?: string;
  status?: number;
}

interface SourceFailureRecord {
  ts: number;
  count: number;
  reason?: string;
  message?: string;
  stage?: string;
  status?: number;
}

export interface SourceFailureInfo {
  coolingDown: boolean;
  count: number;
  remainingMs: number;
  failedAt?: number;
  reason?: string;
  message?: string;
  stage?: string;
  status?: number;
  label: string;
}

type StoredFailureRecord = Record<string, number | SourceFailureRecord>;
type NormalizedFailureRecord = Record<string, SourceFailureRecord>;

function isStorageAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.sessionStorage;
}

function readAll(): NormalizedFailureRecord {
  if (!isStorageAvailable()) return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredFailureRecord;
    if (!parsed || typeof parsed !== 'object') return {};

    const now = Date.now();
    const data: NormalizedFailureRecord = {};
    for (const [key, value] of Object.entries(parsed)) {
      const record = normalizeStoredRecord(value);
      if (!record) continue;
      if (now - record.ts > COOLDOWN_MS) continue;
      data[key] = record;
    }
    return data;
  } catch {
    return {};
  }
}

function writeAll(data: NormalizedFailureRecord): void {
  if (!isStorageAvailable()) return;
  try {
    const now = Date.now();
    for (const key of Object.keys(data)) {
      if (now - data[key].ts > COOLDOWN_MS) {
        delete data[key];
      }
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function markSourceFailed(
  key: string,
  options: SourceFailureMarkOptions = {},
): void {
  if (!key) return;
  const data = readAll();
  const now = Date.now();
  const previous = data[key];
  data[key] = {
    ts: now,
    count: previous ? previous.count + 1 : 1,
    reason: normalizeFailureText(options.reason) || previous?.reason,
    message: normalizeFailureText(options.message) || previous?.message,
    stage: normalizeFailureText(options.stage) || previous?.stage,
    status: Number.isFinite(options.status) ? options.status : previous?.status,
  };
  writeAll(data);
}

export function getSourceFailure(key: string): SourceFailureInfo {
  if (!key) {
    return createEmptyFailureInfo();
  }

  const data = readAll();
  const record = data[key];
  if (!record) {
    return createEmptyFailureInfo();
  }

  const elapsed = Date.now() - record.ts;
  if (elapsed > COOLDOWN_MS) {
    delete data[key];
    writeAll(data);
    return createEmptyFailureInfo();
  }

  return {
    coolingDown: true,
    count: record.count,
    remainingMs: Math.max(0, COOLDOWN_MS - elapsed),
    failedAt: record.ts,
    reason: record.reason,
    message: record.message,
    stage: record.stage,
    status: record.status,
    label: getSourceFailureLabel(record.reason, record.message, record.status),
  };
}

export function clearSourceFailure(key: string): void {
  if (!key) return;
  const data = readAll();
  if (data[key] !== undefined) {
    delete data[key];
    writeAll(data);
  }
}

function getSourceFailureLabel(
  reason?: string,
  message?: string,
  status?: number,
): string {
  if (status && status >= 500) return `代理 ${status}`;

  const text = `${reason || ''} ${message || ''}`.toLowerCase();
  if (!text.trim()) return '近期失败';
  if (text.includes('proxy-500') || text.includes(' 500')) return '代理 500';
  if (text.includes('connection_closed')) return '连接关闭';
  if (text.includes('err_connection_closed')) return '连接关闭';
  if (text.includes('cors')) return 'CORS 失败';
  if (text.includes('timeout') || text.includes('超时')) return '加载超时';
  if (text.includes('proxy')) return '代理失败';
  if (text.includes('segment') || text.includes('frag')) return '分片失败';
  if (text.includes('manifest') || text.includes('level')) return '清单失败';
  if (text.includes('probe')) return '测速失败';
  if (text.includes('episode')) return '集数不匹配';
  if (text.includes('network') || text.includes('fetch')) return '连接失败';
  if (text.includes('media')) return '媒体错误';
  return '近期失败';
}

function normalizeStoredRecord(
  value: number | SourceFailureRecord,
): SourceFailureRecord | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { ts: value, count: 1 };
  }
  if (!value || typeof value !== 'object') {
    return null;
  }

  const ts = Number(value.ts);
  if (!Number.isFinite(ts) || ts <= 0) {
    return null;
  }

  const count = Number(value.count);
  return {
    ts,
    count: Number.isFinite(count) && count > 0 ? count : 1,
    reason: normalizeFailureText(value.reason),
    message: normalizeFailureText(value.message),
    stage: normalizeFailureText(value.stage),
    status: Number.isFinite(value.status) ? value.status : undefined,
  };
}

function createEmptyFailureInfo(): SourceFailureInfo {
  return {
    coolingDown: false,
    count: 0,
    remainingMs: 0,
    label: '',
  };
}

function normalizeFailureText(value?: string): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  return text.slice(0, MAX_FAILURE_TEXT_LENGTH);
}
