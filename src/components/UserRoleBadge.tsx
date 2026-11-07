import { ROLE_TEXT } from '@/components/user-menu/account';
import type { PublicUserRef } from '@/lib/types';

const ROLE_CLASS = {
  owner: 'bg-brand-600 text-white dark:bg-brand-500',
  admin:
    'bg-brand-500/10 text-brand-700 ring-1 ring-inset ring-brand-500/25 dark:text-brand-300',
} as const;

export default function UserRoleBadge({
  role,
}: {
  role: PublicUserRef['role'];
}) {
  if (!role) return null;
  return (
    <span
      className={`inline-flex h-4 shrink-0 items-center rounded px-1 text-[10px] font-medium leading-none ${ROLE_CLASS[role]}`}
    >
      {ROLE_TEXT[role]}
    </span>
  );
}
