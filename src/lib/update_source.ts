import { getRuntimeConfig } from '@/lib/runtime-config';

const DEFAULT_UPDATE_REPOS = ['naseaoi/IceTV'];

const DEFAULT_UPDATE_BRANCH = 'main';

function normalizeRepos(input: unknown): string[] {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  return values
    .map((item) => String(item).trim())
    .filter((repo) => /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo));
}

export function getUpdateRepos(): string[] {
  const runtimeRepos = normalizeRepos(getRuntimeConfig()?.UPDATE_REPOS);
  if (runtimeRepos.length > 0) {
    return runtimeRepos;
  }

  const envRepos = normalizeRepos(process.env.NEXT_PUBLIC_UPDATE_REPOS);
  if (envRepos.length > 0) {
    return envRepos;
  }

  return DEFAULT_UPDATE_REPOS;
}

export function getUpdateBranch(): string {
  const runtimeBranch = getRuntimeConfig()?.UPDATE_BRANCH;
  if (typeof runtimeBranch === 'string' && runtimeBranch.trim()) {
    return runtimeBranch.trim();
  }

  const envBranch = process.env.NEXT_PUBLIC_UPDATE_BRANCH;
  if (typeof envBranch === 'string' && envBranch.trim()) {
    return envBranch.trim();
  }

  return DEFAULT_UPDATE_BRANCH;
}

export function getPrimaryRepoUrl(): string {
  const repos = getUpdateRepos();
  return `https://github.com/${repos[0]}`;
}

export function buildChangelogUrls(): string[] {
  const branch = getUpdateBranch();

  return getUpdateRepos().flatMap((repo) => [
    `https://raw.githubusercontent.com/${repo}/${branch}/public/changelog.json`,
    `https://raw.githubusercontent.com/${repo}/${branch}/changelog.json`,
    `https://raw.githubusercontent.com/${repo}/${branch}/CHANGELOG`,
    `https://raw.githubusercontent.com/${repo}/${branch}/CHANGELOG.md`,
  ]);
}
