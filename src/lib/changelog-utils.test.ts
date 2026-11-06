import {
  buildChangelogManifest,
  extractLatestRelease,
  extractLatestVersion,
  parseChangelog,
} from './changelog-utils';

const RELEASED = `## [0.5.2] - 2026-11-01

### Added

- 已发布功能

## [0.5.1] - 2026-09-11

### Fixed

- 已发布修复
`;

const WITH_UNRELEASED = `## [Unreleased]

### Changed

- 未发布改动

${RELEASED}`;

describe('changelog-utils [Unreleased]', () => {
  it('解析时跳过未发布区块，最新版本取已发布的顶部版本', () => {
    const parsed = parseChangelog(WITH_UNRELEASED);

    expect(parsed.latestVersion).toBe('0.5.2');
    expect(
      parsed.entries.map((entry: { version: string }) => entry.version),
    ).toEqual(['0.5.2', '0.5.1']);
    expect(JSON.stringify(parsed.entries)).not.toContain('未发布改动');
    expect(extractLatestVersion(WITH_UNRELEASED)).toBe('0.5.2');
  });

  it('生成清单与发版说明不包含未发布条目', () => {
    const manifest = buildChangelogManifest(WITH_UNRELEASED);
    const release = extractLatestRelease(WITH_UNRELEASED);

    expect(manifest.errors).toEqual([]);
    expect(manifest).toEqual({ ...buildChangelogManifest(RELEASED) });
    expect(release.errors).toEqual([]);
    expect(release.latestVersion).toBe('0.5.2');
    expect(release.notes).toContain('已发布功能');
    expect(release.notes).not.toContain('未发布改动');
  });

  it('允许空的未发布区块', () => {
    const manifest = buildChangelogManifest(`## [Unreleased]\n\n${RELEASED}`);

    expect(manifest.errors).toEqual([]);
    expect(manifest.latestVersion).toBe('0.5.2');
  });

  it('未发布区块不在顶部或重复出现时报错', () => {
    const misplaced = `${RELEASED}\n## [Unreleased]\n\n### Added\n\n- 放错位置\n`;
    const duplicated = `## [Unreleased]\n\n## [Unreleased]\n\n${RELEASED}`;
    const expected = '[Unreleased] 只能出现一次且位于所有版本之前';

    expect(buildChangelogManifest(misplaced).errors).toContain(expected);
    expect(buildChangelogManifest(duplicated).errors).toContain(expected);
  });

  it('未发布区块的章节标题同样受校验', () => {
    const manifest = buildChangelogManifest(
      `## [Unreleased]\n\n### Removed\n\n- 不支持的章节\n\n${RELEASED}`,
    );

    expect(manifest.errors).toContain('不支持的章节标题: ### Removed');
  });

  it('其他未知二级标题仍报无效版本标题', () => {
    const manifest = buildChangelogManifest(`## Unreleased\n\n${RELEASED}`);

    expect(manifest.errors).toContain('无效的版本标题: ## Unreleased');
  });
});
