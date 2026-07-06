const CHANGELOG_VERSION_RE = /^## \[([\d.]+)\] - (\d{4}-\d{2}-\d{2})$/;
const CHANGELOG_SECTION_RE = /^###\s+(.+)$/;
const CHANGELOG_ITEM_RE = /^-\s+(.+)$/;

const SECTION_MAP = {
  Added: 'added',
  Changed: 'changed',
  Fixed: 'fixed',
};

function createEntry(version, date) {
  return {
    version,
    date,
    added: [],
    changed: [],
    fixed: [],
    content: [],
  };
}

function finalizeEntries(entries) {
  return entries.map((entry) => {
    const nextEntry = {
      version: entry.version,
      date: entry.date,
      added: [...entry.added],
      changed: [...entry.changed],
      fixed: [...entry.fixed],
    };

    if (
      nextEntry.added.length === 0 &&
      nextEntry.changed.length === 0 &&
      nextEntry.fixed.length === 0 &&
      entry.content.length > 0
    ) {
      nextEntry.changed = [...entry.content];
    }

    return nextEntry;
  });
}

function parseChangelog(content) {
  const lines = content.split(/\r?\n/);
  const versions = [];
  let currentVersion = null;
  let currentSection = null;

  for (const line of lines) {
    const trimmedLine = line.trim();

    const versionMatch = trimmedLine.match(CHANGELOG_VERSION_RE);
    if (versionMatch) {
      if (currentVersion) {
        versions.push(currentVersion);
      }

      currentVersion = createEntry(versionMatch[1], versionMatch[2]);
      currentSection = null;
      continue;
    }

    if (!currentVersion || !trimmedLine) {
      continue;
    }

    const sectionMatch = trimmedLine.match(CHANGELOG_SECTION_RE);
    if (sectionMatch) {
      currentSection = SECTION_MAP[sectionMatch[1]] || null;
      continue;
    }

    const itemMatch = trimmedLine.match(CHANGELOG_ITEM_RE);
    if (itemMatch && currentSection) {
      currentVersion[currentSection].push(itemMatch[1].trim());
      continue;
    }

    if (!trimmedLine.startsWith('#')) {
      currentVersion.content.push(trimmedLine);
    }
  }

  if (currentVersion) {
    versions.push(currentVersion);
  }

  const entries = finalizeEntries(versions);

  return {
    latestVersion: entries[0]?.version || null,
    entries,
  };
}

function normalizeVersion(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersionsDesc(left, right) {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart !== rightPart) {
      return rightPart - leftPart;
    }
  }

  return 0;
}

function validateChangelog(content) {
  const lines = content.split(/\r?\n/);
  const errors = [];
  const parsed = parseChangelog(content);
  const seenVersions = new Set();

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (
      trimmedLine.startsWith('## ') &&
      !CHANGELOG_VERSION_RE.test(trimmedLine)
    ) {
      errors.push(`无效的版本标题: ${trimmedLine}`);
    }

    const sectionMatch = trimmedLine.match(CHANGELOG_SECTION_RE);
    if (sectionMatch && !SECTION_MAP[sectionMatch[1]]) {
      errors.push(`不支持的章节标题: ${trimmedLine}`);
    }
  }

  if (parsed.entries.length === 0) {
    errors.push('CHANGELOG 中未找到任何版本');
  }

  parsed.entries.forEach((entry, index) => {
    if (seenVersions.has(entry.version)) {
      errors.push(`发现重复版本: ${entry.version}`);
    }
    seenVersions.add(entry.version);

    if (
      entry.added.length === 0 &&
      entry.changed.length === 0 &&
      entry.fixed.length === 0
    ) {
      errors.push(`版本 ${entry.version} 没有任何更新条目`);
    }

    const previousEntry = parsed.entries[index - 1];
    if (previousEntry) {
      const compareResult = compareVersionsDesc(
        previousEntry.version,
        entry.version,
      );
      if (compareResult > 0) {
        errors.push(
          `版本顺序错误: ${previousEntry.version} 应位于 ${entry.version} 之后`,
        );
      }
    }
  });

  return {
    ...parsed,
    errors,
  };
}

function buildChangelogManifest(content) {
  const parsed = validateChangelog(content);
  return {
    latestVersion: parsed.latestVersion || '',
    entries: parsed.entries,
    errors: parsed.errors,
  };
}

function extractLatestVersion(content) {
  return parseChangelog(content).latestVersion;
}

function renderReleaseNotes(entry) {
  if (!entry) {
    return '';
  }

  const lines = [`发布日期：${entry.date}`, ''];

  if (entry.added.length > 0) {
    lines.push('### Added', '');
    entry.added.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push('');
  }

  if (entry.changed.length > 0) {
    lines.push('### Changed', '');
    entry.changed.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push('');
  }

  if (entry.fixed.length > 0) {
    lines.push('### Fixed', '');
    entry.fixed.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

function extractLatestRelease(content) {
  const parsed = validateChangelog(content);
  const entry = parsed.entries[0] || null;

  return {
    latestVersion: parsed.latestVersion || '',
    entry,
    notes: renderReleaseNotes(entry),
    errors: parsed.errors,
  };
}

module.exports = {
  buildChangelogManifest,
  extractLatestVersion,
  extractLatestRelease,
  parseChangelog,
};
