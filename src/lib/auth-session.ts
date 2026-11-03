export type AuthSessionRole = 'owner' | 'admin' | 'user';

export type ClientAuthSession =
  | {
      status: 'authenticated';
      username: string;
      role: AuthSessionRole;
      profileId: string;
      // null 表示尚未设置，受保护页面会先要求设置
      nickname: string | null;
    }
  | { status: 'guest' }
  | { status: 'error' };
