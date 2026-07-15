export type AuthSessionRole = 'owner' | 'admin' | 'user';

export type ClientAuthSession =
  | {
      status: 'authenticated';
      username: string;
      role: AuthSessionRole;
    }
  | { status: 'guest' }
  | { status: 'error' };
