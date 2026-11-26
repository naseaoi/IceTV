/** @jest-environment node */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('generate manifest version', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'icetv-manifest-'));
    mkdirSync(path.join(root, 'scripts'));
    copyFileSync(
      require.resolve('../../../scripts/generate-manifest.js'),
      path.join(root, 'scripts/generate-manifest.js'),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeBuildVersion(version: string) {
    mkdirSync(path.join(root, '.next'));
    writeFileSync(
      path.join(root, '.next/required-server-files.json'),
      JSON.stringify({ config: { env: { NEXT_PUBLIC_APP_VERSION: version } } }),
    );
  }

  function generate(explicitVersion = '') {
    execFileSync(
      process.execPath,
      [path.join(root, 'scripts/generate-manifest.js')],
      {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NEXT_PUBLIC_APP_VERSION: explicitVersion,
          NEXT_PUBLIC_SITE_NAME: 'Manifest test',
        },
        stdio: 'pipe',
      },
    );
    return JSON.parse(
      readFileSync(path.join(root, 'public/manifest.json'), 'utf8'),
    );
  }

  function expectIconVersion(
    manifest: { icons: { src: string }[] },
    version: string,
  ) {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src.endsWith(`?v=${encodeURIComponent(version)}`)).toBe(true);
    }
  }

  it('无源码且未注入版本时复用 standalone 构建版本，重复启动保持一致', () => {
    writeBuildVersion('2.3.4');
    expectIconVersion(generate(), '2.3.4');
    expectIconVersion(generate('  '), '2.3.4');
  });

  it('显式 ENV 优先于构建产物并保持 URL 编码', () => {
    writeBuildVersion('2.3.4');
    expectIconVersion(generate(' 9.9.9-test+build '), '9.9.9-test+build');
  });

  it('发布 ENV 无需源码或构建元数据即可生成 manifest', () => {
    expectIconVersion(generate('9.9.9-test'), '9.9.9-test');
  });

  it('源码环境重新解析更新日志版本，忽略旧构建产物与包版本', () => {
    writeBuildVersion('0.1.0');
    mkdirSync(path.join(root, 'src/lib'), { recursive: true });
    for (const file of ['build-version.js', 'changelog-utils.js']) {
      copyFileSync(
        path.resolve(__dirname, '..', file),
        path.join(root, 'src/lib', file),
      );
    }
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ version: '1.0.0' }),
    );
    writeFileSync(
      path.join(root, 'CHANGELOG.md'),
      '## [Unreleased]\n\n## [2.3.4] - 2026-11-25\n',
    );
    expectIconVersion(generate(), '2.3.4');
  });
});
