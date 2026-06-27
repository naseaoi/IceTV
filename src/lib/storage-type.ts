export type StorageType = 'localdb' | 'mysql';

function normalizeStorageType(value: string | undefined): StorageType | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'mysql') {
    return 'mysql';
  }

  if (normalized === 'localdb' || normalized === 'sqlite') {
    return 'localdb';
  }

  return null;
}

export function getMySqlConnectionUrl(): string {
  return (process.env.DATABASE_URL || '').trim();
}

export function getStorageType(): StorageType {
  const configured = normalizeStorageType(process.env.NEXT_PUBLIC_STORAGE_TYPE);

  if (configured) {
    return configured;
  }

  return getMySqlConnectionUrl() ? 'mysql' : 'localdb';
}
