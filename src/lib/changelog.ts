import rawChangelogManifest from '~/changelog.json';

export interface ChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
}

export interface ChangelogManifest {
  latestVersion: string;
  generatedAt: number;
  entries: ChangelogEntry[];
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export function normalizeChangelogEntry(value: unknown): ChangelogEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Record<string, unknown>;
  const version = typeof entry.version === 'string' ? entry.version.trim() : '';
  const date = typeof entry.date === 'string' ? entry.date.trim() : '';

  if (!version || !date) {
    return null;
  }

  return {
    version,
    date,
    added: normalizeTextList(entry.added),
    changed: normalizeTextList(entry.changed),
    fixed: normalizeTextList(entry.fixed),
  };
}

export function normalizeChangelogManifest(value: unknown): ChangelogManifest {
  if (!value || typeof value !== 'object') {
    return {
      latestVersion: '',
      generatedAt: 0,
      entries: [],
    };
  }

  const source = value as Record<string, unknown>;
  const entries = Array.isArray(source.entries)
    ? source.entries
        .map((entry) => normalizeChangelogEntry(entry))
        .filter((entry): entry is ChangelogEntry => entry !== null)
    : [];
  const latestVersion =
    typeof source.latestVersion === 'string' ? source.latestVersion.trim() : '';
  const generatedAt =
    typeof source.generatedAt === 'number' &&
    Number.isFinite(source.generatedAt)
      ? source.generatedAt
      : 0;

  return {
    latestVersion: latestVersion || entries[0]?.version || '',
    generatedAt,
    entries,
  };
}

export const changelogData = normalizeChangelogManifest(rawChangelogManifest);

export const changelog = changelogData.entries;
