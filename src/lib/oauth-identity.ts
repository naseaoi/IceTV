export type OAuthIdentity = {
  provider: 'linuxdo';
  providerUserId: string;
  username: string;
  providerUsername: string;
  autoCreated: boolean;
  createdAt: number;
};

export type OAuthBindResult =
  | 'bound'
  | 'identity_taken'
  | 'user_bound'
  | 'user_missing';

export const OAUTH_SCHEMA = `CREATE TABLE IF NOT EXISTS oauth_identities (
  provider VARCHAR(32) NOT NULL,
  provider_user_id VARCHAR(191) NOT NULL,
  username VARCHAR(191) NOT NULL,
  provider_username VARCHAR(191) NOT NULL,
  auto_created INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (provider, username)
)`;
export const OAUTH_INSERT =
  'INSERT INTO oauth_identities (provider, provider_user_id, username, provider_username, auto_created, created_at) VALUES (?, ?, ?, ?, ?, ?)';
export function oauthIdentityParams(identity: OAuthIdentity) {
  return [
    identity.provider,
    identity.providerUserId,
    identity.username,
    identity.providerUsername,
    identity.autoCreated ? 1 : 0,
    identity.createdAt,
  ];
}
export function readOAuthIdentity(
  row?: Record<string, unknown>,
): OAuthIdentity | null {
  return row
    ? {
        provider: 'linuxdo',
        providerUserId: String(row.provider_user_id),
        username: String(row.username),
        providerUsername: String(row.provider_username),
        autoCreated: Boolean(Number(row.auto_created)),
        createdAt: Number(row.created_at),
      }
    : null;
}
export function isOAuthDuplicate(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'ER_DUP_ENTRY' ||
      String(error.code).startsWith('SQLITE_CONSTRAINT'))
  );
}
