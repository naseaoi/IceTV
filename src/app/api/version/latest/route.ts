import { NextResponse } from 'next/server';

import {
  normalizeChangelogEntry,
  normalizeChangelogManifest,
} from '@/lib/changelog';
import { parseChangelog } from '@/lib/changelog-utils';
import { createTimedAbortController } from '@/lib/downstream-sources/shared';
import { readJsonLimited, readTextLimited } from '@/lib/proxy-response-limits';
import {
  compareReleaseVersions,
  DEV_VERSION_PATTERN,
} from '@/lib/release-version';
import {
  buildChangelogUrls,
  getUpdateBranch,
  getUpdateRepos,
} from '@/lib/update-source';
import { fetchUpstream } from '@/lib/upstream-fetch.server';

export const runtime = 'nodejs';

const CHANGELOG_MAX_BYTES = 2 * 1024 * 1024;
const CHANGELOG_TIMEOUT_MS = 10_000;
// 版本接口公开访问，GHCR 结果在进程内缓存；失败缓存更短，便于镜像发布后尽快被发现
const DEV_VERSION_CACHE_MS = 5 * 60 * 1000;
const DEV_VERSION_FAILURE_CACHE_MS = 60 * 1000;

let devVersionCache: {
  repo: string;
  value: string | null;
  expiresAt: number;
} | null = null;

interface RemoteChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
  admin: string[];
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
    const response = await fetchUpstream(url, {
      method: 'GET',
      signal: abortState.signal,
    });
    if (!response.ok) {
      return null;
    }

    const content = await readTextLimited(response, CHANGELOG_MAX_BYTES);

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

async function fetchLatestDevVersion(repo: string): Promise<string | null> {
  const abortState = createTimedAbortController(
    undefined,
    CHANGELOG_TIMEOUT_MS,
  );
  try {
    const imageRepo = repo.toLowerCase();
    const tokenUrl = new URL('https://ghcr.io/token');
    tokenUrl.searchParams.set('scope', `repository:${imageRepo}:pull`);
    const tokenResponse = await fetchUpstream(tokenUrl.href, {
      signal: abortState.signal,
      redirect: 'error',
    });
    if (!tokenResponse.ok) return null;
    const auth = await readJsonLimited<{ token?: unknown }>(
      tokenResponse,
      64 * 1024,
    );
    if (!auth || typeof auth.token !== 'string' || !auth.token) return null;

    const tagsUrl = new URL(`https://ghcr.io/v2/${imageRepo}/tags/list?n=1000`);
    let url = tagsUrl.href;
    let latest: string | null = null;
    for (let page = 0; page < 5; page++) {
      const response = await fetchUpstream(url, {
        signal: abortState.signal,
        redirect: 'error',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) return null;
      const data = await readJsonLimited<{ tags?: unknown }>(
        response,
        CHANGELOG_MAX_BYTES,
      );
      if (!data || !Array.isArray(data.tags)) return null;
      for (const tag of data.tags) {
        if (typeof tag !== 'string' || !DEV_VERSION_PATTERN.test(tag)) continue;
        if (!latest || compareReleaseVersions(tag, latest) === 1) latest = tag;
      }
      const nextLink = response.headers
        .get('link')
        ?.split(',')
        .find((link) => /;\s*rel\s*=\s*"?next"?(?:\s*;|\s*$)/i.test(link));
      if (!nextLink) return latest;
      const target = /^\s*<([^>]+)>/.exec(nextLink)?.[1];
      if (!target) return null;
      const next = new URL(target, url);
      // 分页只能留在同一标签端点，避免把 Bearer token 发给外部地址。
      if (
        next.origin !== tagsUrl.origin ||
        next.pathname !== tagsUrl.pathname ||
        next.username ||
        next.password ||
        next.hash
      )
        return null;
      url = next.href;
    }
    // 超出页数上限时无法确认全仓库最高版本。
    return null;
  } catch {
    return null;
  } finally {
    abortState.cleanup();
  }
}

async function getLatestDevVersion(repo: string): Promise<string | null> {
  const now = Date.now();
  if (devVersionCache?.repo === repo && devVersionCache.expiresAt > now) {
    return devVersionCache.value;
  }
  const value = await fetchLatestDevVersion(repo);
  devVersionCache = {
    repo,
    value,
    expiresAt:
      now + (value ? DEV_VERSION_CACHE_MS : DEV_VERSION_FAILURE_CACHE_MS),
  };
  return value;
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

  if (branch === 'dev') {
    latestVersion = await getLatestDevVersion(repos[0]);
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
