/** @jest-environment node */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { resolveAppVersion } from '@/lib/build-version';

jest.mock('node:child_process', () => ({ execFileSync: jest.fn() }));
jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const mockGit = execFileSync as jest.Mock;
const mockExists = existsSync as jest.Mock;
const mockRead = readFileSync as jest.Mock;
const options = {
  rootDir: 'test-repo',
  nodeEnv: 'development' as const,
  explicitVersion: '',
  packageVersion: '0.5.0',
};

describe('build app version', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGit.mockReturnValue('v0.5.1-dev.10\nv0.5.1-dev.9\n');
    mockExists.mockReturnValue(true);
    mockRead.mockReturnValue('## [0.5.0] - 2026-09-01\n');
  });

  it('显式注入的版本优先，不访问 Git', () => {
    expect(
      resolveAppVersion({ ...options, explicitVersion: ' 0.5.1-dev.5 ' }),
    ).toBe('0.5.1-dev.5');
    expect(mockGit).not.toHaveBeenCalled();
  });

  it('开发模式读取当前提交可达的 dev 标签并使用版本排序', () => {
    expect(resolveAppVersion(options)).toBe('0.5.1-dev.10');
    expect(mockGit).toHaveBeenCalledWith(
      'git',
      ['tag', '--list', '--merged=HEAD', '--sort=-version:refname', 'v*-dev.*'],
      expect.objectContaining({
        cwd: 'test-repo',
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2000,
      }),
    );
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('非开发模式仍使用正式版，不读取 dev 标签', () => {
    expect(resolveAppVersion({ ...options, nodeEnv: 'production' })).toBe(
      '0.5.0',
    );
    expect(mockGit).not.toHaveBeenCalled();
  });

  it('忽略不符合 dev 版本格式的标签', () => {
    mockGit.mockReturnValue(
      'v1.0.0-dev.preview\nv0.5.1-dev.5-extra\nv0.5.1-dev.5\n',
    );
    expect(resolveAppVersion(options)).toBe('0.5.1-dev.5');
  });

  it('没有 dev 标签时回退到更新日志', () => {
    mockGit.mockReturnValue('');
    expect(resolveAppVersion(options)).toBe('0.5.0');
  });

  it('Git 不可用或源码包没有 Git 时仍能启动', () => {
    mockGit.mockImplementation(() => {
      throw new Error('git unavailable');
    });
    expect(resolveAppVersion(options)).toBe('0.5.0');
  });

  it('更新日志缺失时回退到包版本', () => {
    mockGit.mockReturnValue('');
    mockExists.mockReturnValue(false);
    expect(resolveAppVersion(options)).toBe('0.5.0');
    expect(resolveAppVersion({ ...options, packageVersion: '' })).toBe('0.0.0');
  });
});
