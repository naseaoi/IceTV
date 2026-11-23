'use client';

import { Check } from 'lucide-react';

import type { RegisterChannels } from '@/types/admin';

const LAST_CHANNEL_TITLE = '至少保留一个注册通道';

function ChannelChip({
  label,
  pressed,
  disabled,
  inactive,
  title,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  disabled: boolean;
  // 已勾选但当前不生效
  inactive?: boolean;
  title?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type='button'
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onToggle}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition-colors disabled:cursor-not-allowed ${
        pressed
          ? `bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/30 ${inactive ? 'opacity-60' : ''}`
          : 'text-gray-600 ring-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:hover:bg-transparent dark:text-gray-300 dark:ring-white/[0.08] dark:hover:bg-white/[0.04]'
      }`}
    >
      {pressed && <Check className='h-3.5 w-3.5' />}
      {label}
    </button>
  );
}

export function RegisterChannelChips({
  channels,
  linuxDoActive,
  busy,
  onChange,
}: {
  channels: RegisterChannels;
  // LinuxDo 登录已配置并启用
  linuxDoActive: boolean;
  busy: boolean;
  onChange: (next: RegisterChannels) => void;
}) {
  const passwordIsLast = channels.Password && !channels.LinuxDo;
  const linuxDoIsLast = channels.LinuxDo && !channels.Password;
  const linuxDoTitle = !linuxDoActive
    ? channels.LinuxDo
      ? 'LinuxDo 登录未启用，此通道暂不生效'
      : '需先启用 LinuxDo 登录'
    : linuxDoIsLast
      ? LAST_CHANNEL_TITLE
      : undefined;
  return (
    <div role='group' aria-label='注册通道' className='flex gap-1.5'>
      <ChannelChip
        label='账号'
        pressed={channels.Password}
        disabled={busy || passwordIsLast}
        title={passwordIsLast ? LAST_CHANNEL_TITLE : undefined}
        onToggle={() => onChange({ ...channels, Password: !channels.Password })}
      />
      <ChannelChip
        label='LinuxDo'
        pressed={channels.LinuxDo}
        inactive={!linuxDoActive}
        disabled={
          busy || linuxDoIsLast || (!channels.LinuxDo && !linuxDoActive)
        }
        title={linuxDoTitle}
        onToggle={() => onChange({ ...channels, LinuxDo: !channels.LinuxDo })}
      />
    </div>
  );
}
