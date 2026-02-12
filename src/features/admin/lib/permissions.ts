export type AdminRole = 'owner' | 'admin' | null;

export interface ManagedUser {
  username: string;
  role: 'user' | 'admin' | 'owner';
}

interface PermissionContext {
  role: AdminRole;
  currentUsername: string | null;
}

export function canConfigureUser(
  user: ManagedUser,
  context: PermissionContext,
): boolean {
  const { role, currentUsername } = context;
  return (
    role === 'owner' ||
    (role === 'admin' &&
      (user.role === 'user' || user.username === currentUsername))
  );
}

export function canChangeUserPassword(
  user: ManagedUser,
  context: PermissionContext,
): boolean {
  if (user.role === 'owner') {
    return false;
  }
  return canConfigureUser(user, context);
}

export function canDeleteManagedUser(
  user: ManagedUser,
  context: PermissionContext,
): boolean {
  const { role, currentUsername } = context;
  return (
    user.username !== currentUsername &&
    (role === 'owner' || (role === 'admin' && user.role === 'user'))
  );
}

export function canOperateUser(
  user: ManagedUser,
  context: PermissionContext,
): boolean {
  const { role, currentUsername } = context;
  return (
    user.username !== currentUsername &&
    (role === 'owner' || (role === 'admin' && user.role === 'user'))
  );
}

export function getSelectableUsers<T extends ManagedUser>(
  users: T[],
  context: PermissionContext,
): T[] {
  return users.filter((user) => canConfigureUser(user, context));
}

export function isOwner(role: AdminRole): role is 'owner' {
  return role === 'owner';
}
