import { NextResponse } from 'next/server';

import {
  normalizeChangelogEntry,
  normalizeChangelogManifest,
} from '@/lib/changelog';
import { parseChangelog } from '@/lib/changelog-utils';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import { readResponseTextWithLimit } from '@/lib/response-text';
import {
  buildChangelogUrls,
  getUpdateBranch,
  getUpdateRepos,
} from '@/lib/update-source';

export const runtime = 'nodejs';

const CHANGELOG_MAX_BYTES = 2 * 1024 * 1024;
const CHANGELOG_TIMEOUT_MS = 10_000;

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
  const abortState = createTimedAbortController(
    undefined,
    CHANGELOG_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: abortState.signal,
    });
    if (!response.ok) {
      return null;
    }

    const content = await readResponseTextWithLimit(
      response,
      CHANGELOG_MAX_BYTES,
      '更新日志',
    );

    if (url.endsWith('.json')) {
      const manifest = normalizeChangelogManifest(JSON.parse(content));
      if (!manifest.latestVersion && manifest.entries.length === 0) {
        return null;
      }

      return {
        latestVersion:
          manifest.latestVersion || manifest.entries[0]?.version || null,
        changelog: manifest.entries,
      };
    }

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
  } finally {
    abortState.cleanup();
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
