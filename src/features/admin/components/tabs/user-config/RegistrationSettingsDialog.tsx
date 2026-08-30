'use client';

import { Check, Copy, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

import AdminDialog from '@/features/admin/components/AdminDialog';
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
  description,
  checked,
  disabled,
  label,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className='flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900'>
      <div>
        <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
          {title}
        </p>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          {description}
        </p>
      </div>
      <button
        type='button'
        onClick={onToggle}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        aria-label={label}
        aria-pressed={checked}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
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
        <Check className='h-4 w-4 text-green-500' />
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
      panelClassName='max-w-2xl'
    >
      <div className='space-y-4'>
        <ToggleRow
          title='开放注册'
          description='开启后，未注册用户可通过注册接口自行创建账号。'
          checked={openRegister}
          disabled={isTogglingRegister}
          label='切换开放注册'
          onToggle={onToggleOpenRegister}
        />

        <ToggleRow
          title='需要邀请码'
          description='开启后，注册时必须填写未过期的邀请码。'
          checked={requireInviteCode}
          disabled={isTogglingInvite || !openRegister}
          label='切换邀请码要求'
          onToggle={onToggleRequireInviteCode}
        />

        {!openRegister && (
          <p className='text-xs text-gray-500 dark:text-gray-400'>
            注册已关闭，邀请码设置暂不生效。
          </p>
        )}

        <div>
          <h4 className='mb-3 text-sm font-medium text-gray-700 dark:text-gray-300'>
            邀请码
          </h4>

          <div className='mb-3 flex flex-wrap items-end gap-3'>
            <div className='min-w-[180px] flex-1'>
              <label
                htmlFor='invite-custom-code'
                className='mb-1 block text-xs text-gray-500 dark:text-gray-400'
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
                className={`w-full text-sm uppercase ${inputStyles.withFocus}`}
              />
            </div>
            <div>
              <label
                htmlFor='invite-valid-days'
                className='mb-1 block text-xs text-gray-500 dark:text-gray-400'
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
                className={`w-24 text-sm ${inputStyles.withFocus}`}
              />
            </div>
            <div>
              <label
                htmlFor='invite-max-uses'
                className='mb-1 block text-xs text-gray-500 dark:text-gray-400'
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
                className={`w-28 text-sm ${inputStyles.withFocus}`}
              />
            </div>
            <button
              onClick={onCreateCode}
              disabled={isCreatingCode}
              title={isCreatingCode ? '生成中...' : '生成邀请码'}
              aria-label='生成邀请码'
              className={
                isCreatingCode
                  ? buttonStyles.iconDisabled
                  : buttonStyles.iconSuccess
              }
            >
              {isCreatingCode ? (
                <Loader2 className='h-5 w-5 animate-spin' />
              ) : (
                <Plus className='h-5 w-5' />
              )}
            </button>
          </div>

          {inviteCodes.length === 0 ? (
            <p className='rounded-lg border border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400'>
              还没有邀请码。
            </p>
          ) : (
            <div className='max-h-64 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700'>
              <table className='w-full text-sm'>
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
                                : 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                            }`}
                          >
                            {expired ? '已过期' : exhausted ? '已用尽' : '有效'}
                          </span>
                        </td>
                        <td className='px-4 py-2 text-right'>
                          <button
                            onClick={() => onDeleteCode(item.code)}
                            disabled={deletingCode === item.code}
                            className={`${buttonStyles.roundedDanger} ${
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
