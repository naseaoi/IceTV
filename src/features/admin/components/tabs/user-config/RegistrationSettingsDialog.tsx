'use client';

import { Check, Copy, Plus } from 'lucide-react';
import { useState } from 'react';

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

interface RegistrationSettingsDialogProps {
  isOpen: boolean;
  openRegister: boolean;
  requireInviteCode: boolean;
  inviteCodes: InviteCode[];
  validDays: number;
  customCode: string;
  maxUses: string;
  isTogglingRegister: boolean;
  isTogglingInvite: boolean;
  isCreatingCode: boolean;
  deletingCode: string | null;
  onToggleOpenRegister: () => void;
  onToggleRequireInviteCode: () => void;
  onValidDaysChange: (next: number) => void;
  onCustomCodeChange: (next: string) => void;
  onMaxUsesChange: (next: string) => void;
  onCreateCode: () => void;
  onDeleteCode: (code: string) => void;
  onClose: () => void;
}

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
    <div className='flex items-center justify-between gap-4 py-2'>
      <div>
        <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
          {title}
        </p>
      </div>
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
      className='rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200'
    >
      {copied ? (
        <Check className='h-4 w-4 text-brand-500' />
      ) : (
        <Copy className='h-4 w-4' />
      )}
    </button>
  );
}

export function RegistrationSettingsDialog({
  isOpen,
  openRegister,
  requireInviteCode,
  inviteCodes,
  validDays,
  customCode,
  maxUses,
  isTogglingRegister,
  isTogglingInvite,
  isCreatingCode,
  deletingCode,
  onToggleOpenRegister,
  onToggleRequireInviteCode,
  onValidDaysChange,
  onCustomCodeChange,
  onMaxUsesChange,
  onCreateCode,
  onDeleteCode,
  onClose,
}: RegistrationSettingsDialogProps) {
  return (
    <AdminDialog
      isOpen={isOpen}
      title='注册管理'
      onClose={onClose}
      panelClassName='max-w-2xl max-h-[80vh] overflow-y-auto'
    >
      <div className='space-y-4'>
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

        <div>
          <h4 className='mb-3 text-sm font-medium text-gray-900 dark:text-gray-100'>
            邀请码
          </h4>

          <div className='mb-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-2'>
            <div className='min-w-0'>
              <label
                htmlFor='invite-custom-code'
                className='mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100'
              >
                自定义邀请码（留空则随机生成）
              </label>
              <input
                id='invite-custom-code'
                type='text'
                autoComplete='off'
                autoCapitalize='characters'
                spellCheck={false}
                maxLength={CUSTOM_INVITE_CODE_MAX_LENGTH}
                placeholder='字母数字、下划线、连字符'
                value={customCode}
                onChange={(e) => onCustomCodeChange(e.target.value)}
                className={`w-full uppercase ${inputStyles.withFocus}`}
              />
            </div>
            <div>
              <label
                htmlFor='invite-valid-days'
                className='mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100'
              >
                有效期（天）
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
              <label
                htmlFor='invite-max-uses'
                className='mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100'
              >
                可用次数（留空不限）
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
              onClick={onCreateCode}
              disabled={isCreatingCode}
              title={isCreatingCode ? '生成中...' : '生成邀请码'}
              aria-label='生成邀请码'
              className={`${buttonStyles.primary} flex h-9 items-center justify-center gap-2 justify-self-end disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {isCreatingCode ? (
                <Spinner className='h-5 w-5' />
              ) : (
                <Plus className='h-5 w-5' />
              )}
              生成邀请码
            </button>
          </div>

          {inviteCodes.length === 0 ? (
            <p className='rounded-xl p-4 text-sm text-gray-500 ring-1 ring-gray-200 dark:text-gray-400 dark:ring-white/[0.06]'>
              还没有邀请码。
            </p>
          ) : (
            <div className='max-h-64 overflow-auto rounded-xl ring-1 ring-gray-200 dark:ring-white/[0.06]'>
              <table className='w-full whitespace-nowrap text-sm'>
                <thead className='sticky top-0 bg-gray-50 dark:bg-gray-900'>
                  <tr>
                    <th className='px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400'>
                      邀请码
                    </th>
                    <th className='px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400'>
                      剩余次数
                    </th>
                    <th className='px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400'>
                      状态
                    </th>
                    <th className='px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-400'>
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                  {inviteCodes.map((item) => {
                    const expired = isInviteCodeExpired(item);
                    const exhausted = isInviteCodeExhausted(item);
                    const remaining = getInviteCodeRemainingUses(item);
                    return (
                      <tr key={item.code}>
                        <td className='px-4 py-2 font-mono text-gray-900 dark:text-gray-100'>
                          <div className='flex items-center gap-1.5'>
                            <span>{item.code}</span>
                            <CopyCodeButton code={item.code} />
                          </div>
                        </td>
                        <td className='px-4 py-2 text-gray-600 dark:text-gray-300'>
                          {remaining === null
                            ? '不限'
                            : `${remaining} / ${item.maxUses}`}
                        </td>
                        <td
                          className='px-4 py-2'
                          title={formatDateTime(item.expiresAt)}
                        >
                          <span
                            className={`rounded-full px-2 py-1 text-xs ${
                              expired || exhausted
                                ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                : 'bg-brand-100 text-brand-800 dark:bg-brand-900/20 dark:text-brand-300'
                            }`}
                          >
                            {expired ? '已过期' : exhausted ? '已用尽' : '有效'}
                          </span>
                        </td>
                        <td className='px-4 py-2 text-right'>
                          <button
                            onClick={() => onDeleteCode(item.code)}
                            disabled={deletingCode === item.code}
                            className={`${buttonStyles.danger} ${
                              deletingCode === item.code
                                ? 'cursor-not-allowed opacity-50'
                                : ''
                            }`}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminDialog>
  );
}
