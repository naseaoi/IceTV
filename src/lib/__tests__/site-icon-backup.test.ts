/** @jest-environment node */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'icetv-icon-'));

describe('site icon backup round trip', () => {
  const originalCwd = process.cwd;

  beforeAll(() => {
    process.cwd = () => tempRoot;
  });

  afterAll(() => {
    process.cwd = originalCwd;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  afterEach(() => {
    const iconDir = path.join(tempRoot, 'data', 'icons');
    if (fs.existsSync(iconDir)) {
      fs.rmSync(iconDir, { recursive: true, force: true });
    }
  });

  function load() {
    return require('../site-icon-storage.server') as typeof import('../site-icon-storage.server');
  }

  it('returns null when no local icon exists', () => {
    expect(load().readSiteIconForBackup()).toBeNull();
  });

  it('round trips an icon through backup and restore', () => {
    const mod = load();
    const iconDir = path.join(tempRoot, 'data', 'icons');
    fs.mkdirSync(iconDir, { recursive: true });
    const payload = Buffer.from('fake-png-bytes');
    fs.writeFileSync(path.join(iconDir, 'site-icon.png'), payload);

    const backup = mod.readSiteIconForBackup();
    expect(backup).toEqual({
      extension: '.png',
      base64: payload.toString('base64'),
    });

    fs.rmSync(path.join(iconDir, 'site-icon.png'));
    mod.restoreSiteIconFromBackup(backup!);

    expect(
      fs.readFileSync(path.join(iconDir, 'site-icon.png')).toString(),
    ).toBe('fake-png-bytes');
  });

  it('replaces an existing icon of a different extension', () => {
    const mod = load();
    const iconDir = path.join(tempRoot, 'data', 'icons');
    fs.mkdirSync(iconDir, { recursive: true });
    fs.writeFileSync(path.join(iconDir, 'site-icon.jpg'), 'old');

    mod.restoreSiteIconFromBackup({
      extension: '.png',
      base64: Buffer.from('new').toString('base64'),
    });

    const files = fs
      .readdirSync(iconDir)
      .filter((name) => name.startsWith('site-icon'));
    expect(files).toEqual(['site-icon.png']);
  });

  it('rejects unsupported extensions', () => {
    const mod = load();
    expect(() =>
      mod.restoreSiteIconFromBackup({
        extension: '.exe',
        base64: Buffer.from('x').toString('base64'),
      }),
    ).toThrow('站点图标格式无效');
  });

  it('rejects empty payloads', () => {
    const mod = load();
    expect(() =>
      mod.restoreSiteIconFromBackup({ extension: '.png', base64: '' }),
    ).toThrow('站点图标大小超出限制');
  });

  it('validates supported extensions', () => {
    const mod = load();
    expect(mod.isSupportedSiteIconExtension('.png')).toBe(true);
    expect(mod.isSupportedSiteIconExtension('.svg')).toBe(true);
    expect(mod.isSupportedSiteIconExtension('.exe')).toBe(false);
  });
});
