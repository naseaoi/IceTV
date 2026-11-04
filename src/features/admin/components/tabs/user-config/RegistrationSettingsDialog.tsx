'use client';

import { Check, Copy, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import Select from '@/components/Select';
import Spinner from '@/components/Spinner';
import AdminDialog from '@/features/admin/components/AdminDialog';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { formatDateTime } from '@/features/admin/lib/formatDateTime';
import {
  type InviteCode,
  CUSTOM_INVITE_CODE_MAX_LENGTH,
  getInviteCodeRemainingUses,
  isInviteCodeExhausted,
  isInviteCodeExpired,
  MAX_INVITE_MAX_USES,
  MAX_INVITE_VALID_DAYS,
  MIN_INVITE_MAX_USES,
  MIN_INVITE_VALID_DAYS,
} from '@/features/admin/services/inviteCodes';
import { copyTextToClipboard } from '@/lib/clipboard';
import type { InviteCodeFilter } from '@/lib/invite-code-storage';

export interface InviteCodeListState {
  items: InviteCode[];
  total: number;
  activeCount: number;
  nextCursor: string | null;
  loading: boolean;
  error: string;
  refresh: () => void;
  loadMore: () => void;
}

interface RegistrationSettingsDialogProps {
  isOpen: boolean;
  openRegister: boolean;
  requireInviteCode: boolean;
  inviteFilter: InviteCodeFilter;
  inviteList: InviteCodeListState;
  validDays: number;
  customCode: string;
  maxUses: string;
  isTogglingRegister: boolean;
  isTogglingInvite: boolean;
  isCreatingCode: boolean;
  deletingCode: string | null;
  onToggleOpenRegister: () => void;
  onToggleRequireInviteCode: () => void;
  onInviteFilterChange: (next: InviteCodeFilter) => void;
  onValidDaysChange: (next: number) => void;
  onCustomCodeChange: (next: string) => void;
  onMaxUsesChange: (next: string) => void;
  onCreateCode: () => void;
  onDeleteCode: (code: string) => void;
  onClose: () => void;
}

const LABEL_CLASS =
  'mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100';

function ToggleRow({
  title,
  checked,
  disabled,
  label,
  onToggle,
}: {
  title: string;
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className='flex items-center justify-between gap-4 py-2.5'>
      <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
        {title}
      </p>
      <AdminStatusSwitch
        enabled={checked}
        isLoading={disabled}
        ariaLabel={label}
        onToggle={onToggle}
      />
    </div>
  );
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(code);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type='button'
      onClick={handleCopy}
      title={copied ? '已复制' : '复制邀请码'}
      aria-label={`复制邀请码 ${code}`}
      className='shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200'
    >
      {copied ? (
        <Check className='h-4 w-4 text-brand-500' />
      ) : (
        <Copy className='h-4 w-4' />
      )}
    </button>
  );
}

function InviteCodeRow({
  item,
  deleting,
  onDelete,
}: {
  item: InviteCode;
  deleting: boolean;
  onDelete: (code: string) => void;
}) {
  const expired = isInviteCodeExpired(item);
  const exhausted = isInviteCodeExhausted(item);
  const remaining = getInviteCodeRemainingUses(item);
  return (
    <li className='flex items-center gap-3 px-4 py-2.5'>
      <div className='min-w-0 flex-1'>
        <div className='flex h-5 items-center gap-1'>
          <span className='truncate font-mono text-sm text-gray-900 dark:text-gray-100'>
            {item.code}
          </span>
          <CopyCodeButton code={item.code} />
        </div>
        <p className='mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400'>
          {remaining === null
            ? '不限次数'
            : `剩余 ${remaining} / ${item.maxUses}`}
          {' · '}
          {formatDateTime(item.expiresAt)} {expired ? '过期' : '到期'}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
          expired || exhausted
            ? 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400'
            : 'bg-brand-100 text-brand-800 dark:bg-brand-900/30 dark:text-brand-300'
        }`}
      >
        {expired ? '已过期' : exhausted ? '已用尽' : '有效'}
      </span>
      <button
        type='button'
        onClick={() => onDelete(item.code)}
        disabled={deleting}
        aria-label={`删除邀请码 ${item.code}`}
        title='删除'
        className='shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-500/10 dark:hover:text-red-400'
      >
        {deleting ? (
          <Spinner className='h-4 w-4' />
        ) : (
          <Trash2 className='h-4 w-4' />
        )}
      </button>
    </li>
  );
}

function InviteCodeRowsSkeleton() {
  return (
    <div
      role='status'
      aria-label='加载邀请码'
      className='divide-y divide-gray-200 dark:divide-white/[0.06]'
    >
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className='flex items-center gap-3 px-4 py-2.5'>
          <div className='min-w-0 flex-1'>
            <div className='flex h-5 items-center'>
              <div className='skeleton h-3.5 w-32 rounded' />
            </div>
            <div className='mt-0.5 flex h-4 items-center'>
              <div className='skeleton h-3 w-44 rounded' />
            </div>
          </div>
          <div className='skeleton h-5 w-10 rounded-full' />
          <div className='skeleton h-8 w-8 rounded-lg' />
        </div>
      ))}
    </div>
  );
}

export function RegistrationSettingsDialog({
  isOpen,
  openRegister,
  requireInviteCode,
  inviteFilter,
  inviteList,
  validDays,
  customCode,
  maxUses,
  isTogglingRegister,
  isTogglingInvite,
  isCreatingCode,
  deletingCode,
  onToggleOpenRegister,
  onToggleRequireInviteCode,
  onInviteFilterChange,
  onValidDaysChange,
  onCustomCodeChange,
  onMaxUsesChange,
  onCreateCode,
  onDeleteCode,
  onClose,
}: RegistrationSettingsDialogProps) {
  const { items, total, activeCount, nextCursor, loading, error } = inviteList;
  const initialLoading = loading && items.length === 0;

  return (
    <AdminDialog
      isOpen={isOpen}
      title='注册管理'
      onClose={onClose}
      panelClassName='max-w-2xl max-h-[85vh] overflow-y-auto'
    >
      <div className='space-y-5'>
        <div className='divide-y divide-gray-200 dark:divide-white/[0.06]'>
          <ToggleRow
            title='开放注册'
            checked={openRegister}
            disabled={isTogglingRegister}
            label='切换开放注册'
            onToggle={onToggleOpenRegister}
          />
          <ToggleRow
            title='需要邀请码'
            checked={requireInviteCode}
            disabled={isTogglingInvite || !openRegister}
            label='切换邀请码要求'
            onToggle={onToggleRequireInviteCode}
          />
        </div>

        <section aria-labelledby='invite-code-heading'>
          <h4
            id='invite-code-heading'
            className='mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100'
          >
            邀请码
          </h4>

          <div className='mb-4 grid grid-cols-2 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_auto]'>
            <div className='col-span-2 min-w-0 sm:col-span-1'>
              <label htmlFor='invite-custom-code' className={LABEL_CLASS}>
                自定义邀请码
              </label>
              <input
                id='invite-custom-code'
                type='text'
                autoComplete='off'
                autoCapitalize='characters'
                spellCheck={false}
                maxLength={CUSTOM_INVITE_CODE_MAX_LENGTH}
                placeholder='留空随机生成'
                value={customCode}
                onChange={(e) => onCustomCodeChange(e.target.value)}
                className={`w-full uppercase placeholder:normal-case ${inputStyles.withFocus}`}
              />
            </div>
            <div>
              <label htmlFor='invite-valid-days' className={LABEL_CLASS}>
                有效天数
              </label>
              <input
                id='invite-valid-days'
                type='number'
                min={MIN_INVITE_VALID_DAYS}
                max={MAX_INVITE_VALID_DAYS}
                value={validDays}
                onChange={(e) => onValidDaysChange(Number(e.target.value))}
                className={`w-full ${inputStyles.withFocus}`}
              />
            </div>
            <div>
              <label htmlFor='invite-max-uses' className={LABEL_CLASS}>
                可用次数
              </label>
              <input
                id='invite-max-uses'
                type='number'
                min={MIN_INVITE_MAX_USES}
                max={MAX_INVITE_MAX_USES}
                placeholder='不限'
                value={maxUses}
                onChange={(e) => onMaxUsesChange(e.target.value)}
                className={`w-full ${inputStyles.withFocus}`}
              />
            </div>
            <button
              type='button'
              onClick={onCreateCode}
              disabled={isCreatingCode}
              aria-label='生成邀请码'
              className={`${buttonStyles.primary} col-span-2 flex h-[38px] items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1`}
            >
              {isCreatingCode ? (
                <Spinner className='h-4 w-4' />
              ) : (
                <Plus className='h-4 w-4' />
              )}
              生成
            </button>
          </div>

          <div className='mb-2 flex items-center justify-between gap-3'>
            <Select
              value={inviteFilter}
              onChange={(value) =>
                onInviteFilterChange(value as InviteCodeFilter)
              }
              ariaLabel='筛选邀请码状态'
              variant='pill'
              options={[
                { value: 'all', label: '全部' },
                { value: 'active', label: `有效 ${activeCount}` },
                { value: 'expired', label: '已过期' },
                { value: 'exhausted', label: '已用尽' },
              ]}
            />
            {!error && !initialLoading && (
              <span className='text-xs text-gray-500 dark:text-gray-400'>
                共 {total} 个
              </span>
            )}
          </div>

          <div className='overflow-hidden rounded-xl ring-1 ring-gray-200 dark:ring-white/[0.06]'>
            {error ? (
              <div
                role='alert'
                className='flex items-center justify-between gap-3 px-4 py-3 text-sm text-red-600 dark:text-red-400'
              >
                <span>{error}</span>
                <button
                  type='button'
                  onClick={inviteList.refresh}
                  className={buttonStyles.outline}
                >
                  重试
                </button>
              </div>
            ) : initialLoading ? (
              <InviteCodeRowsSkeleton />
            ) : items.length === 0 ? (
              <p className='px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400'>
                {inviteFilter === 'all'
                  ? '还没有邀请码'
                  : '没有符合条件的邀请码'}
              </p>
            ) : (
              <ul
                aria-label='邀请码列表'
                className='max-h-80 divide-y divide-gray-200 overflow-y-auto dark:divide-white/[0.06]'
              >
                {items.map((item) => (
                  <InviteCodeRow
                    key={item.code}
                    item={item}
                    deleting={deletingCode === item.code}
                    onDelete={onDeleteCode}
                  />
                ))}
                {nextCursor && (
                  <li className='flex justify-center px-4 py-2'>
                    <button
                      type='button'
                      disabled={loading}
                      onClick={inviteList.loadMore}
                      className='text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50 dark:text-brand-400 dark:hover:text-brand-300'
                    >
                      {loading ? '加载中...' : '加载更多'}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>
      </div>
    </AdminDialog>
  );
}
