import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const SITE_ICON_PREFIX = 'site-icon';
const STAGED_ICON_PREFIX = 'staged-site-icon-';
const STAGED_ICON_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const iconExtensionByContentType: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

export const SITE_ICON_MAX_SIZE = 512 * 1024;
export const SITE_ICON_CONTENT_TYPES = Object.keys(iconExtensionByContentType);

export function getSiteIconDir(): string {
  const dataDir =
    process.env.NODE_ENV === 'production'
      ? '/data'
      : path.resolve(process.cwd(), 'data');
  return path.join(dataDir, 'icons');
}

function ensureSiteIconDir(): string {
  const iconDir = getSiteIconDir();
  fs.mkdirSync(iconDir, { recursive: true });
  return iconDir;
}

function removeFilesByPrefix(iconDir: string, prefix: string): void {
  if (!fs.existsSync(iconDir)) return;
  for (const fileName of fs.readdirSync(iconDir)) {
    if (fileName.startsWith(prefix)) {
      fs.unlinkSync(path.join(iconDir, fileName));
    }
  }
}

function cleanupExpiredStagedIcons(iconDir: string): void {
  const expiresBefore = Date.now() - STAGED_ICON_MAX_AGE_MS;
  for (const fileName of fs.readdirSync(iconDir)) {
    if (!fileName.startsWith(STAGED_ICON_PREFIX)) continue;
    const filePath = path.join(iconDir, fileName);
    if (fs.statSync(filePath).mtimeMs < expiresBefore) {
      fs.unlinkSync(filePath);
    }
  }
}

export async function stageSiteIcon(file: File): Promise<string> {
  const extension = iconExtensionByContentType[file.type];
  if (!extension) {
    throw new Error('站点图标格式无效');
  }

  const iconDir = ensureSiteIconDir();
  cleanupExpiredStagedIcons(iconDir);
  const token = randomUUID();
  const filePath = path.join(
    iconDir,
    `${STAGED_ICON_PREFIX}${token}${extension}`,
  );
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()), {
    flag: 'wx',
  });
  return token;
}

export function hasStagedSiteIcon(token: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return false;
  const iconDir = getSiteIconDir();
  if (!fs.existsSync(iconDir)) return false;
  return fs
    .readdirSync(iconDir)
    .some((fileName) => fileName.startsWith(`${STAGED_ICON_PREFIX}${token}`));
}

export function commitStagedSiteIcon(token: string): void {
  if (!hasStagedSiteIcon(token)) {
    throw new Error('站点图标暂存标识无效');
  }

  const iconDir = getSiteIconDir();
  if (!fs.existsSync(iconDir)) {
    throw new Error('暂存的站点图标不存在');
  }

  const stagedPrefix = `${STAGED_ICON_PREFIX}${token}`;
  const stagedFile = fs
    .readdirSync(iconDir)
    .find((fileName) => fileName.startsWith(stagedPrefix));
  if (!stagedFile) {
    throw new Error('暂存的站点图标不存在');
  }

  const extension = path.extname(stagedFile);
  const currentFile = fs
    .readdirSync(iconDir)
    .find((fileName) => fileName.startsWith(SITE_ICON_PREFIX));
  const backupFile = currentFile
    ? `previous-${SITE_ICON_PREFIX}-${token}${path.extname(currentFile)}`
    : null;
  if (currentFile && backupFile) {
    fs.renameSync(
      path.join(iconDir, currentFile),
      path.join(iconDir, backupFile),
    );
  }

  try {
    fs.renameSync(
      path.join(iconDir, stagedFile),
      path.join(iconDir, `${SITE_ICON_PREFIX}${extension}`),
    );
    if (backupFile) {
      fs.unlinkSync(path.join(iconDir, backupFile));
    }
  } catch (error) {
    if (
      currentFile &&
      backupFile &&
      fs.existsSync(path.join(iconDir, backupFile))
    ) {
      fs.renameSync(
        path.join(iconDir, backupFile),
        path.join(iconDir, currentFile),
      );
    }
    throw error;
  }
}

export function removeSiteIcon(): void {
  removeFilesByPrefix(getSiteIconDir(), SITE_ICON_PREFIX);
}

export function findSiteIconFile(): string | null {
  const iconDir = getSiteIconDir();
  if (!fs.existsSync(iconDir)) return null;
  const fileName = fs
    .readdirSync(iconDir)
    .find((entry) => entry.startsWith(SITE_ICON_PREFIX));
  return fileName ? path.join(iconDir, fileName) : null;
}
