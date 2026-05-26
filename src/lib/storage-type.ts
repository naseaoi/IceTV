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
  return (
    process.env.DATABASE_URL ||
    process.env.MYSQL_URL ||
    process.env.MySQL ||
    ''
  ).trim();
}

export function getStorageType(): StorageType {
  const configured = normalizeStorageType(
    process.env.NEXT_PUBLIC_STORAGE_TYPE || process.env.STORAGE_TYPE,
  );

  if (configured) {
    return configured;
  }

  return getMySqlConnectionUrl() ? 'mysql' : 'localdb';
}
