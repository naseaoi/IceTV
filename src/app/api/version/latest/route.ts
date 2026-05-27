import { NextResponse } from 'next/server';

import {
  normalizeChangelogEntry,
  normalizeChangelogManifest,
} from '@/lib/changelog';
import {
  buildChangelogUrls,
  getUpdateBranch,
  getUpdateRepos,
} from '@/lib/update-source';
import { parseChangelog } from '@/lib/changelog-utils';

export const runtime = 'nodejs';

interface RemoteChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
}

async function fetchChangelogFromUrl(url: string): Promise<{
  latestVersion: string | null;
  changelog: RemoteChangelogEntry[];
} | null> {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) {
      return null;
    }

    if (url.endsWith('.json')) {
      const manifest = normalizeChangelogManifest(await response.json());
      if (!manifest.latestVersion && manifest.entries.length === 0) {
        return null;
      }

      return {
        latestVersion:
          manifest.latestVersion || manifest.entries[0]?.version || null,
        changelog: manifest.entries,
      };
    }

    const content = await response.text();
    const parsed = parseChangelog(content);
    const changelog = parsed.entries
      .map((entry: RemoteChangelogEntry) => normalizeChangelogEntry(entry))
      .filter(
        (
          entry: ReturnType<typeof normalizeChangelogEntry>,
        ): entry is RemoteChangelogEntry => entry !== null,
      );

    if (!parsed.latestVersion && changelog.length === 0) {
      return null;
    }

    return {
      latestVersion: parsed.latestVersion || changelog[0]?.version || null,
      changelog,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const repos = getUpdateRepos();
  const branch = getUpdateBranch();

  let latestVersion: string | null = null;
  let changelog: RemoteChangelogEntry[] = [];

  for (const url of buildChangelogUrls()) {
    const result = await fetchChangelogFromUrl(url);
    if (result) {
      latestVersion = result.latestVersion;
      changelog = result.changelog;
      break;
    }
  }

  return NextResponse.json(
    {
      latestVersion,
      changelog,
      sources: {
        repos,
        branch,
      },
      checkedAt: Date.now(),
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    },
  );
}
