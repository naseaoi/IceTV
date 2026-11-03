'use client';

import {
  type LucideIcon,
  ChevronRight,
  Info,
  KeyRound,
  Palette,
  Shield,
  SlidersHorizontal,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';

import { useAuthSession } from '@/components/AuthProvider';
import ConfirmModal from '@/components/modals/ConfirmModal';
import PageLayout from '@/components/PageLayout';
import ProfileAvatar from '@/components/ProfileAvatar';
import {
  buildLoginHref,
  logout,
  ROLE_TEXT,
  useHasUpdate,
} from '@/components/user-menu/account';
import {
  ChangePasswordPanel,
  SettingsPanel,
  VersionPanel,
} from '@/components/user-menu/lazy-panels';
import { ProfilePanel } from '@/components/user-menu/ProfilePanel';
import { UserAvatar } from '@/components/user-menu/UserAvatar';
import { useClientHydrated } from '@/hooks/useClientHydrated';
import { CURRENT_VERSION } from '@/lib/version';

type Panel = 'profile' | 'local' | 'password' | 'version' | 'logout' | null;

const GROUP_CLASS =
  'divide-y divide-gray-200/70 overflow-hidden rounded-2xl bg-white text-gray-900 ring-1 ring-gray-900/[0.06] dark:divide-white/[0.06] dark:bg-gray-900 dark:text-gray-100 dark:ring-white/[0.06]';
const ROW_CLASS =
  'flex min-h-[3.25rem] w-full items-center gap-3 px-4 text-left text-[15px]';
const PRESSABLE_ROW_CLASS = `${ROW_CLASS} transition-colors active:bg-gray-900/[0.04] dark:active:bg-white/[0.05] md:hover:bg-gray-900/[0.03] md:dark:hover:bg-white/[0.03]`;

const THEME_OPTIONS = [
  { value: 'system', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-900/[0.05] text-gray-600 dark:bg-white/[0.07] dark:text-gray-300'>
      <Icon
        aria-hidden='true'
        className='h-[18px] w-[18px]'
        strokeWidth={1.75}
      />
    </span>
  );
}

function RowChevron() {
  return (
    <ChevronRight
      aria-hidden='true'
      className='h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600'
    />
  );
}

function ActionRow({
  icon,
  label,
  trailing,
  onClick,
  href,
}: {
  icon: LucideIcon;
  label: string;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const content = (
    <>
      <RowIcon icon={icon} />
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {trailing}
      <RowChevron />
    </>
  );
  return href ? (
    <Link href={href} className={PRESSABLE_ROW_CLASS}>
      {content}
    </Link>
  ) : (
    <button type='button' onClick={onClick} className={PRESSABLE_ROW_CLASS}>
      {content}
    </button>
  );
}

function ThemeRow() {
  const { theme, setTheme } = useTheme();
  const hydrated = useClientHydrated();
  const current = hydrated ? (theme ?? 'system') : null;

  return (
    <div className={ROW_CLASS}>
      <RowIcon icon={Palette} />
      <span className='min-w-0 flex-1'>外观</span>
      <div
        role='radiogroup'
        aria-label='外观'
        className='flex shrink-0 rounded-lg bg-gray-900/[0.05] p-0.5 dark:bg-white/[0.07]'
      >
        {THEME_OPTIONS.map((option) => {
          const active = current === option.value;
          return (
            <button
              key={option.value}
              type='button'
              role='radio'
              aria-checked={active}
              onClick={() => setTheme(option.value)}
              className={`h-7 rounded-md px-3 text-[13px] transition-colors ${
                active
                  ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-white/[0.16] dark:text-white'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsPageClient() {
  const router = useRouter();
  const { session } = useAuthSession();
  const hasUpdate = useHasUpdate();
  const [panel, setPanel] = useState<Panel>(null);
  const close = () => setPanel(null);

  const account = session.status === 'authenticated' ? session : null;
  const isAdmin = account?.role === 'owner' || account?.role === 'admin';

  return (
    <PageLayout activePath='/settings'>
      <div className='mx-auto w-full max-w-2xl space-y-5 px-4 pb-10 pt-4 md:pt-10'>
        <h1 className='hidden text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-50 md:block'>
          设置
        </h1>

        <div className={GROUP_CLASS}>
          {account ? (
            <button
              type='button'
              onClick={() => setPanel('profile')}
              className={`${PRESSABLE_ROW_CLASS} py-3`}
            >
              <ProfileAvatar
                profileId={account.profileId}
                nickname={account.nickname}
                className='h-12 w-12 text-lg'
              />
              <span className='min-w-0 flex-1'>
                <span className='block truncate text-base font-semibold'>
                  {account.nickname ?? account.username}
                </span>
                <span className='mt-0.5 block text-[13px] text-gray-500 dark:text-gray-400'>
                  {ROLE_TEXT[account.role]} · 编辑资料
                </span>
              </span>
              <RowChevron />
            </button>
          ) : (
            <div className={`${ROW_CLASS} py-3`}>
              <UserAvatar size='lg' />
              <span className='min-w-0 flex-1 text-base font-semibold'>
                未登录
              </span>
              <button
                type='button'
                onClick={() => router.push(buildLoginHref())}
                className='h-8 shrink-0 rounded-full bg-brand-600 px-4 text-[13px] font-medium text-white transition-colors active:bg-brand-700 md:hover:bg-brand-500'
              >
                登录
              </button>
            </div>
          )}
        </div>

        <div className={GROUP_CLASS}>
          <ThemeRow />
          <ActionRow
            icon={SlidersHorizontal}
            label='本地设置'
            onClick={() => setPanel('local')}
          />
        </div>

        {account && (
          <div className={GROUP_CLASS}>
            {account.role !== 'owner' && (
              <ActionRow
                icon={KeyRound}
                label='修改密码'
                onClick={() => setPanel('password')}
              />
            )}
            {isAdmin && (
              <ActionRow icon={Shield} label='管理后台' href='/admin' />
            )}
          </div>
        )}

        <div className={GROUP_CLASS}>
          <ActionRow
            icon={Info}
            label='版本信息'
            onClick={() => setPanel('version')}
            trailing={
              <span className='flex shrink-0 items-center gap-2 text-[13px] text-gray-400 dark:text-gray-500'>
                {hasUpdate && (
                  <span className='rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-600 dark:text-brand-300'>
                    有新版本
                  </span>
                )}
                <span className='font-mono'>v{CURRENT_VERSION}</span>
              </span>
            }
          />
        </div>

        {account && (
          <div className={GROUP_CLASS}>
            <button
              type='button'
              onClick={() => setPanel('logout')}
              className={`${PRESSABLE_ROW_CLASS} justify-center font-medium text-red-600 dark:text-red-400`}
            >
              退出登录
            </button>
          </div>
        )}
      </div>

      {panel === 'profile' && <ProfilePanel onClose={close} />}
      {panel === 'local' &&
        createPortal(<SettingsPanel onClose={close} />, document.body)}
      {panel === 'password' &&
        createPortal(
          <ChangePasswordPanel onClose={close} onLogout={logout} />,
          document.body,
        )}
      {panel === 'version' && <VersionPanel isOpen onClose={close} />}
      <ConfirmModal
        isOpen={panel === 'logout'}
        title='退出登录'
        message='确定要退出当前账号吗？'
        confirmText='退出'
        danger
        onClose={close}
        onConfirm={() => void logout()}
      />
    </PageLayout>
  );
}
