export type UpstreamResourceKind = 'metadata' | 'vod' | 'live' | 'probe';

export interface UpstreamResourceContext {
  kind?: UpstreamResourceKind;
  identity?: string;
}

export function resourceLimitSetting(
  name: string,
  fallback: number,
  maximum = 1_000_000,
): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum
    ? value
    : fallback;
}

export function upstreamResourcePolicy(kind: UpstreamResourceKind) {
  const probe = kind === 'probe';
  const media = kind === 'vod' || kind === 'live';
  const prefix = probe
    ? 'SOURCE_PROBE'
    : media
      ? 'UPSTREAM_MEDIA'
      : 'UPSTREAM_METADATA';
  const mib = 1024 * 1024;
  const globalConcurrency = resourceLimitSetting(
    `${prefix}_CONCURRENCY`,
    probe ? 8 : media ? 96 : 64,
  );
  const globalRpm = resourceLimitSetting(
    `${prefix}_RPM`,
    probe ? 480 : media ? 12000 : 1800,
  );
  return {
    globalConcurrency,
    hostConcurrency: probe
      ? globalConcurrency
      : resourceLimitSetting(`${prefix}_HOST_CONCURRENCY`, media ? 32 : 12),
    userConcurrency: resourceLimitSetting(
      probe
        ? 'SOURCE_PROBE_USER_CONCURRENCY'
        : 'UPSTREAM_MEDIA_USER_CONCURRENCY',
      probe ? 2 : 6,
    ),
    liveConcurrency: resourceLimitSetting('UPSTREAM_LIVE_CONCURRENCY', 32),
    globalRpm,
    hostRpm: probe
      ? globalRpm
      : resourceLimitSetting(`${prefix}_HOST_RPM`, media ? 6000 : 300),
    globalBytes: media
      ? resourceLimitSetting('UPSTREAM_MEDIA_MIB_PER_MINUTE', 1536) * mib
      : 0,
    hostBytes: media
      ? resourceLimitSetting('UPSTREAM_MEDIA_HOST_MIB_PER_MINUTE', 768) * mib
      : 0,
    userBytes: media
      ? resourceLimitSetting('UPSTREAM_MEDIA_USER_MIB_PER_MINUTE', 192) * mib
      : 0,
    maxDurationMs:
      resourceLimitSetting(
        `${prefix}_MAX_DURATION_SECONDS`,
        probe ? 20 : media ? 120 : 60,
        600,
      ) * 1000,
  };
}
