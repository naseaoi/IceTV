export type ClientAuthSession =
  | { status: 'authenticated'; username: string }
  | { status: 'guest' }
  | { status: 'error' };
