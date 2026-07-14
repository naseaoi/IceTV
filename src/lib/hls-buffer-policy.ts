export type HlsBufferEnvironment = {
  saveData?: boolean;
  effectiveType?: string;
  deviceMemory?: number;
  userAgent?: string;
};

export type HlsBufferDefaults = {
  maxBufferLength: number;
  maxMaxBufferLength: number;
  backBufferLength: number;
  maxBufferSize: number;
};

const SLOW_NETWORK_TYPES = new Set(['slow-2g', '2g', '3g']);
const MOBILE_USER_AGENT_PATTERN = /Android|iPhone|iPad|iPod|Mobile|Tablet/i;

export function resolveHlsBufferDefaults(
  environment: HlsBufferEnvironment,
): HlsBufferDefaults {
  if (
    environment.saveData === true ||
    (environment.effectiveType &&
      SLOW_NETWORK_TYPES.has(environment.effectiveType))
  ) {
    return {
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 30,
      maxBufferSize: 30 * 1000 * 1000,
    };
  }

  const lowMemory =
    typeof environment.deviceMemory === 'number' &&
    environment.deviceMemory > 0 &&
    environment.deviceMemory <= 4;
  const mobile = MOBILE_USER_AGENT_PATTERN.test(environment.userAgent || '');
  if (lowMemory || mobile) {
    return {
      maxBufferLength: 60,
      maxMaxBufferLength: 180,
      backBufferLength: 60,
      maxBufferSize: 60 * 1000 * 1000,
    };
  }

  return {
    maxBufferLength: 120,
    maxMaxBufferLength: 600,
    backBufferLength: 120,
    maxBufferSize: 120 * 1000 * 1000,
  };
}
