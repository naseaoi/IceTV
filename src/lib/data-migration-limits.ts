// 导出与导入共用同一套上限，避免导出成功却导入被拒
export const MAX_BACKUP_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_BACKUP_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
