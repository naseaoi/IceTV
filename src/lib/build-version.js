const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { extractLatestVersion } = require('./changelog-utils');

function resolveAppVersion({
  rootDir,
  packageVersion,
  explicitVersion = process.env.NEXT_PUBLIC_APP_VERSION,
  nodeEnv = process.env.NODE_ENV,
}) {
  if (explicitVersion?.trim()) return explicitVersion.trim();

  if (nodeEnv === 'development') {
    try {
      const tags = execFileSync(
        'git',
        [
          'tag',
          '--list',
          '--merged=HEAD',
          '--sort=-version:refname',
          'v*-dev.*',
        ],
        {
          cwd: rootDir,
          encoding: 'utf8',
          windowsHide: true,
          timeout: 2000,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      const latestDevTag = tags
        .split(/\r?\n/)
        .find((tag) => /^v\d+\.\d+\.\d+-dev\.\d+$/.test(tag));
      if (latestDevTag) return latestDevTag.slice(1);
    } catch {}
  }

  try {
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    if (fs.existsSync(changelogPath)) {
      const latestVersion = extractLatestVersion(
        fs.readFileSync(changelogPath, 'utf8'),
      );
      if (latestVersion) return latestVersion;
    }
  } catch (error) {
    console.warn('读取版本号失败:', error);
  }

  return packageVersion || '0.0.0';
}

module.exports = { resolveAppVersion };
