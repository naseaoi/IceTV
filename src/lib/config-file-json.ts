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
