import type { AdminConfig } from '@/types/admin';

type ConfigFileData = {
  api_site?: Record<string, unknown>;
  lives?: Record<string, unknown>;
  [key: string]: unknown;
};

function parseConfigFile(configFile: string): ConfigFileData | null {
  if (!configFile.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(configFile) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as ConfigFileData)
      : null;
  } catch {
    return null;
  }
}

export function removeConfigFileEntries(
  configFile: string,
  section: 'api_site' | 'lives',
  keys: string[],
): string {
  const cleanKeys = Array.from(
    new Set(keys.map((key) => key.trim()).filter(Boolean)),
  );
  if (cleanKeys.length === 0) {
    return configFile;
  }

  const parsed = parseConfigFile(configFile);
  const entries = parsed?.[section];
  if (!parsed || !entries || typeof entries !== 'object') {
    return configFile;
  }

  cleanKeys.forEach((key) => {
    delete entries[key];
  });

  return JSON.stringify(parsed, null, 2);
}

export function buildConfigFileFromAdminConfig(config: AdminConfig): string {
  const parsed = parseConfigFile(config.ConfigFile) || {};
  const apiSiteEntries = config.SourceConfig.filter(
    (source) => source.key.trim() && source.name.trim() && source.api.trim(),
  ).map((source) => {
    const site: { name: string; api: string; detail?: string } = {
      name: source.name,
      api: source.api,
    };
    if (source.detail?.trim()) {
      site.detail = source.detail;
    }
    return [source.key, site] as const;
  });
  const liveEntries = (config.LiveConfig || [])
    .filter((live) => live.key.trim() && live.name.trim() && live.url.trim())
    .map((live) => {
      const liveConfig: {
        name: string;
        url: string;
        ua?: string;
        epg?: string;
      } = {
        name: live.name,
        url: live.url,
      };
      if (live.ua?.trim()) {
        liveConfig.ua = live.ua;
      }
      if (live.epg?.trim()) {
        liveConfig.epg = live.epg;
      }
      return [live.key, liveConfig] as const;
    });

  parsed.api_site = Object.fromEntries(apiSiteEntries);
  parsed.lives = Object.fromEntries(liveEntries);

  return JSON.stringify(parsed, null, 2);
}
