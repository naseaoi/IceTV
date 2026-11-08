'use client';

import {
  Check,
  CircleCheck,
  Copy,
  Eraser,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import Select from '@/components/Select';
import SkeletonText from '@/components/SkeletonText';
import Spinner from '@/components/Spinner';
import AdminDialog from '@/features/admin/components/AdminDialog';
import { ADMIN_PANEL_CLASS } from '@/features/admin/components/AdminSettings';
import { AdminStatusSwitch } from '@/features/admin/components/AdminStatusSwitch';
import type { InviteCodeDraft } from '@/features/admin/hooks/useAdminUserActions';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { formatDateTime } from '@/features/admin/lib/formatDateTime';
import {
  type InviteCode,
  CUSTOM_INVITE_CODE_MAX_LENGTH,
  CUSTOM_INVITE_CODE_RULE_MESSAGE,
  getInviteCodeRemainingUses,
  INVITE_MAX_USES_RULE_MESSAGE,
  isInviteCodeExhausted,
  isInviteCodeExpired,
  isValidCustomInviteCode,
  MAX_INVITE_BATCH_SIZE,
  MAX_INVITE_CODES,
  MAX_INVITE_MAX_USES,
  MAX_INVITE_VALID_DAYS,
  MIN_INVITE_MAX_USES,
  MIN_INVITE_VALID_DAYS,
  parseInviteMaxUses,
  parseInviteValidDays,
} from '@/features/admin/services/inviteCodes';
import { copyTextToClipboard } from '@/lib/clipboard';
import type { InviteCodeFilter } from '@/lib/invite-code-storage';
import type { LinuxDoLoginSettings, LinuxDoTrustLevel } from '@/types/admin';

export interface InviteCodeListState {
  items: InviteCode[];
  total: number;
  activeCount: number;
  inactiveCount: number;
  nextCursor: string | null;
  // 骨架行数依据；未知时按 1 行
  expectedCount?: number;
  loading: boolean;
  error: string;
  refresh: () => void;
  loadMore: () => void;
}

interface RegistrationSettingsDialogProps {
  isOpen: boolean;
  openRegister: boolean;
  requireInviteCode: boolean;
  userGroupNames: string[];
  defaultUserGroup: string;
  isSettingDefaultGroup: boolean;
  inviteFilter: InviteCodeFilter;
  inviteList: InviteCodeListState;
  isTogglingRegister: boolean;
  isTogglingInvite: boolean;
  linuxDoConfigured: boolean;
  linuxDo: LinuxDoLoginSettings;
  isSettingLinuxDo: boolean;
  onToggleLinuxDo: () => void;
  onLinuxDoTrustLevelChange: (level: LinuxDoTrustLevel) => void;
  isCreatingCode: boolean;
  deletingCode: string | null;
  isPurgingCodes: boolean;
  onToggleOpenRegister: () => void;
  onToggleRequireInviteCode: () => void;
  onDefaultUserGroupChange: (next: string) => void;
  onInviteFilterChange: (next: InviteCodeFilter) => void;
  // 成功返回本次生成的邀请码，失败返回 null（错误由调用方提示）
  onCreateCodes: (draft: InviteCodeDraft) => Promise<string[] | null>;
  onDeleteCode: (code: string) => void;
  onPurgeInactiveCodes: () => void;
  onClose: () => void;
}

const LINUXDO_TRUST_LEVEL_OPTIONS = [
  { value: '0', label: '0 级 · 新用户' },
  { value: '1', label: '1 级 · 基本用户' },
  { value: '2', label: '2 级 · 成员' },
  { value: '3', label: '3 级 · 活跃用户' },
  { value: '4', label: '4 级 · 领导者' },
];

const DEFAULT_VALID_DAYS = 7;
const COPIED_FEEDBACK_MS = 1500;

const INVITE_CODE_TEXT_CLASS = 'font-mono text-sm';
const INVITE_ROW_CLASS = 'flex items-center gap-3 px-4 py-2.5';
const INVITE_LIST_CLASS =
  'max-h-80 divide-y divide-gray-200 dark:divide-white/[0.06]';
// 列表限高 max-h-80（320px）约容纳 5.5 行，多出的骨架行被裁掉
const MAX_SKELETON_ROWS = 6;
const INVITE_META_TEXT_CLASS = 'mt-0.5 text-xs';
const SECTION_TITLE_CLASS =
  'text-sm font-semibold text-gray-900 dark:text-gray-100';
const LABEL_CLASS =
  'mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-300';
const INVALID_INPUT_CLASS =
  'aria-[invalid=true]:ring-red-400 dark:aria-[invalid=true]:ring-red-500/70';
const NUMBER_INPUT_CLASS =
  'tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

type DraftField = 'count' | 'validDays' | 'maxUses' | 'customCode';

// 同一时间只保留一个“已复制”反馈，切换复制目标时前一个立即复位
function useCopyFeedback() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async (key: string, text: string) => {
    if (!(await copyTextToClipboard(text))) return;
    window.clearTimeout(timer.current);
    setCopiedKey(key);
    timer.current = window.setTimeout(
      () => setCopiedKey(null),
      COPIED_FEEDBACK_MS,
    );
  };

  return { copiedKey, copy };
}

function ToggleRow({
  title,
  addon,
  checked,
  disabled,
  label,
  onToggle,
}: {
  title: string;
  addon?: ReactNode;
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className='flex items-center justify-between gap-4 px-4 py-3'>
      <p className='flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100'>
        {title}
        {addon}
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

function NumberField({
  id,
  label,
  suffix,
  value,
  min,
  max,
  placeholder,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  min: number;
  max: number;
  placeholder?: string;
  invalid: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className='min-w-0'>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <div className='relative'>
        <input
          id={id}
          type='number'
          inputMode='numeric'
          min={min}
          max={max}
          step={1}
          placeholder={placeholder}
          value={value}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full pr-8 ${inputStyles.withFocus} ${NUMBER_INPUT_CLASS} ${INVALID_INPUT_CLASS}`}
        />
        <span
          aria-hidden='true'
          className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-400 dark:text-gray-500'
        >
          {suffix}
        </span>
      </div>
    </div>
  );
}

function CreatedCodesCard({
  codes,
  onDismiss,
}: {
  codes: string[];
  onDismiss: () => void;
}) {
  const { copiedKey, copy } = useCopyFeedback();
  const allCopied = copiedKey === '*';

  return (
    <div className='rounded-xl bg-brand-50/70 p-3 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/[0.06] dark:ring-brand-400/15'>
      <div className='flex items-center justify-between gap-3'>
        <p
          role='status'
          className='flex items-center gap-1.5 text-sm font-medium text-brand-800 dark:text-brand-200'
        >
          <CircleCheck className='h-4 w-4 shrink-0' />
          已生成 {codes.length} 个邀请码
        </p>
        <div className='flex shrink-0 items-center gap-1'>
          {codes.length > 1 && (
            <button
              type='button'
              onClick={() => void copy('*', codes.join('\n'))}
              className='inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-500/10'
            >
              {allCopied ? (
                <Check className='h-3.5 w-3.5' />
              ) : (
                <Copy className='h-3.5 w-3.5' />
              )}
              {allCopied ? '已复制' : '复制全部'}
            </button>
          )}
          <button
            type='button'
            onClick={onDismiss}
            aria-label='收起生成结果'
            className='rounded-lg p-1 text-brand-700/70 transition-colors hover:bg-brand-100 hover:text-brand-800 dark:text-brand-300/70 dark:hover:bg-brand-500/10 dark:hover:text-brand-200'
          >
            <X className='h-4 w-4' />
          </button>
        </div>
      </div>
      <ul
        aria-label='本次生成的邀请码'
        className='motion-stagger mt-2.5 grid max-h-44 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3'
      >
        {codes.map((code, index) => {
          const copied = copiedKey === code;
          return (
            <li
              key={code}
              style={{ '--stagger-index': index } as CSSProperties}
            >
              <button
                type='button'
                onClick={() => void copy(code, code)}
                aria-label={`复制邀请码 ${code}`}
                className='group flex w-full items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-left ring-1 ring-inset ring-brand-100 transition-colors hover:ring-brand-300 dark:bg-gray-900 dark:ring-white/[0.06] dark:hover:ring-brand-400/40'
              >
                <span
                  className={`truncate ${INVITE_CODE_TEXT_CLASS} text-gray-900 dark:text-gray-100`}
                >
                  {code}
                </span>
                {copied ? (
                  <Check className='h-3.5 w-3.5 shrink-0 text-brand-500' />
                ) : (
                  <Copy className='h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500 dark:text-gray-600 dark:group-hover:text-gray-300' />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InviteCodeGenerator({
  activeCount,
  isCreating,
  onCreateCodes,
}: {
  activeCount: number;
  isCreating: boolean;
  onCreateCodes: (draft: InviteCodeDraft) => Promise<string[] | null>;
}) {
  const [count, setCount] = useState('1');
  const [validDays, setValidDays] = useState(String(DEFAULT_VALID_DAYS));
  const [maxUses, setMaxUses] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [error, setError] = useState<{
    field: DraftField;
    message: string;
  } | null>(null);
  const [created, setCreated] = useState<{ id: number; codes: string[] }>({
    id: 0,
    codes: [],
  });

  const maxCount = Math.min(
    MAX_INVITE_BATCH_SIZE,
    Math.max(0, MAX_INVITE_CODES - activeCount),
  );
  const parsedCount = Number(count);
  const isBatch = Number.isFinite(parsedCount) && parsedCount > 1;

  const update =
    (field: DraftField, setter: (next: string) => void) => (next: string) => {
      setter(next);
      if (error?.field === field) setError(null);
    };

  const validate = (): InviteCodeDraft | null => {
    if (
      !Number.isInteger(parsedCount) ||
      parsedCount < 1 ||
      parsedCount > maxCount
    ) {
      setError({
        field: 'count',
        message:
          maxCount === 1
            ? '当前只能再生成 1 个'
            : `数量需在 1-${maxCount} 之间`,
      });
      return null;
    }
    const days = parseInviteValidDays(Number(validDays));
    if (days === null || validDays.trim() === '') {
      setError({
        field: 'validDays',
        message: `有效天数需在 ${MIN_INVITE_VALID_DAYS}-${MAX_INVITE_VALID_DAYS} 之间`,
      });
      return null;
    }
    const trimmedMaxUses = maxUses.trim();
    const uses = parseInviteMaxUses(
      trimmedMaxUses ? Number(trimmedMaxUses) : undefined,
    );
    if (uses === null) {
      setError({ field: 'maxUses', message: INVITE_MAX_USES_RULE_MESSAGE });
      return null;
    }
    const code = isBatch ? '' : customCode.trim();
    if (code && !isValidCustomInviteCode(code)) {
      setError({
        field: 'customCode',
        message: CUSTOM_INVITE_CODE_RULE_MESSAGE,
      });
      return null;
    }
    return {
      count: parsedCount,
      validDays: days,
      ...(uses ? { maxUses: uses } : {}),
      ...(code ? { customCode: code } : {}),
    };
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isCreating) return;
    const draft = validate();
    if (!draft) return;
    const codes = await onCreateCodes(draft);
    if (!codes?.length) return;
    setCustomCode('');
    setCreated((previous) => ({ id: previous.id + 1, codes }));
  };

  return (
    <div className='space-y-3'>
      <form
        noValidate
        onSubmit={handleSubmit}
        className='rounded-xl bg-gray-50 p-3 ring-1 ring-inset ring-gray-200 dark:bg-white/[0.02] dark:ring-white/[0.06] sm:p-4'
      >
        <div className='grid grid-cols-3 gap-2.5 sm:gap-3'>
          <NumberField
            id='invite-count'
            label='数量'
            suffix='个'
            value={count}
            min={1}
            max={Math.max(1, maxCount)}
            invalid={error?.field === 'count'}
            onChange={update('count', setCount)}
          />
          <NumberField
            id='invite-valid-days'
            label='有效天数'
            suffix='天'
            value={validDays}
            min={MIN_INVITE_VALID_DAYS}
            max={MAX_INVITE_VALID_DAYS}
            invalid={error?.field === 'validDays'}
            onChange={update('validDays', setValidDays)}
          />
          <NumberField
            id='invite-max-uses'
            label='每码可用'
            suffix='次'
            value={maxUses}
            min={MIN_INVITE_MAX_USES}
            max={MAX_INVITE_MAX_USES}
            placeholder='不限'
            invalid={error?.field === 'maxUses'}
            onChange={update('maxUses', setMaxUses)}
          />
        </div>
        <div className='mt-3 flex items-end gap-2.5 sm:gap-3'>
          <div className='min-w-0 flex-1'>
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
              placeholder={isBatch ? '批量时随机生成' : '留空随机生成'}
              value={isBatch ? '' : customCode}
              disabled={isBatch}
              aria-invalid={error?.field === 'customCode'}
              onChange={(e) =>
                update('customCode', setCustomCode)(e.target.value)
              }
              className={`w-full font-mono uppercase placeholder:font-sans placeholder:normal-case ${inputStyles.withFocus} ${INVALID_INPUT_CLASS}`}
            />
          </div>
          <button
            type='submit'
            disabled={isCreating || maxCount === 0}
            title={
              maxCount === 0
                ? `有效邀请码已达 ${MAX_INVITE_CODES} 个`
                : undefined
            }
            className={`${buttonStyles.primary} inline-flex h-[38px] shrink-0 items-center justify-center gap-1.5 px-4 disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isCreating ? (
              <Spinner className='h-4 w-4' />
            ) : (
              <Plus className='h-4 w-4' />
            )}
            {isBatch && parsedCount <= maxCount
              ? `生成 ${parsedCount} 个`
              : '生成'}
          </button>
        </div>
        {error && (
          <p
            role='alert'
            className='mt-2 text-xs text-red-600 dark:text-red-400'
          >
            {error.message}
          </p>
        )}
      </form>

      {created.codes.length > 0 && (
        <CreatedCodesCard
          key={created.id}
          codes={created.codes}
          onDismiss={() =>
            setCreated((previous) => ({ ...previous, codes: [] }))
          }
        />
      )}
    </div>
  );
}

function InviteCodeRow({
  item,
  deleting,
  copied,
  onCopy,
  onDelete,
}: {
  item: InviteCode;
  deleting: boolean;
  copied: boolean;
  onCopy: (code: string) => void;
  onDelete: (code: string) => void;
}) {
  const expired = isInviteCodeExpired(item);
  const exhausted = isInviteCodeExhausted(item);
  const usable = !expired && !exhausted;
  const remaining = getInviteCodeRemainingUses(item);
  return (
    <li className={INVITE_ROW_CLASS}>
      <div className='min-w-0 flex-1'>
        <div className='flex h-5 items-center gap-1'>
          <span
            className={`truncate ${INVITE_CODE_TEXT_CLASS} ${
              usable
                ? 'text-gray-900 dark:text-gray-100'
                : 'text-gray-400 line-through decoration-gray-300 dark:text-gray-500 dark:decoration-gray-600'
            }`}
          >
            {item.code}
          </span>
          <button
            type='button'
            onClick={() => onCopy(item.code)}
            title={copied ? '已复制' : '复制邀请码'}
            aria-label={`复制邀请码 ${item.code}`}
            className='shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200'
          >
            {copied ? (
              <Check className='h-4 w-4 text-brand-500' />
            ) : (
              <Copy className='h-4 w-4' />
            )}
          </button>
        </div>
        <p
          className={`truncate ${INVITE_META_TEXT_CLASS} text-gray-500 dark:text-gray-400`}
        >
          {remaining === null
            ? '不限次数'
            : `剩余 ${remaining} / ${item.maxUses}`}
          {' · '}
          {formatDateTime(item.expiresAt)} {expired ? '过期' : '到期'}
        </p>
      </div>
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
          usable
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
            : 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400'
        }`}
      >
        <span
          aria-hidden='true'
          className={`h-1.5 w-1.5 rounded-full ${
            usable ? 'bg-brand-500' : 'bg-gray-400 dark:bg-gray-500'
          }`}
        />
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

function InviteCodeRowsSkeleton({ count }: { count: number }) {
  return (
    <div
      role='status'
      aria-label='加载邀请码'
      className={`${INVITE_LIST_CLASS} overflow-hidden`}
    >
      {Array.from({ length: Math.min(count, MAX_SKELETON_ROWS) }, (_, i) => (
        <div key={i} className={INVITE_ROW_CLASS}>
          <div className='min-w-0 flex-1'>
            <SkeletonText
              className={INVITE_CODE_TEXT_CLASS}
              barClassName='h-3.5 w-32 rounded'
            />
            <SkeletonText
              className={INVITE_META_TEXT_CLASS}
              barClassName='h-3 w-44 rounded'
            />
          </div>
          <div className='skeleton h-5 w-12 rounded-full' />
          <div className='skeleton h-8 w-8 rounded-lg' />
        </div>
      ))}
    </div>
  );
}

function Section({
  id,
  title,
  addon,
  children,
}: {
  id: string;
  title: string;
  addon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <div className='mb-2.5 flex min-h-8 items-center justify-between gap-3'>
        <h4 id={id} className={SECTION_TITLE_CLASS}>
          {title}
        </h4>
        {addon}
      </div>
      {children}
    </section>
  );
}

export function RegistrationSettingsDialog({
  isOpen,
  openRegister,
  requireInviteCode,
  userGroupNames,
  defaultUserGroup,
  isSettingDefaultGroup,
  inviteFilter,
  inviteList,
  isTogglingRegister,
  isTogglingInvite,
  linuxDoConfigured,
  linuxDo,
  isSettingLinuxDo,
  onToggleLinuxDo,
  onLinuxDoTrustLevelChange,
  isCreatingCode,
  deletingCode,
  isPurgingCodes,
  onToggleOpenRegister,
  onToggleRequireInviteCode,
  onDefaultUserGroupChange,
  onInviteFilterChange,
  onCreateCodes,
  onDeleteCode,
  onPurgeInactiveCodes,
  onClose,
}: RegistrationSettingsDialogProps) {
  const {
    items,
    total,
    activeCount,
    inactiveCount,
    nextCursor,
    loading,
    error,
  } = inviteList;
  const expectedCount = inviteList.expectedCount ?? 1;
  const initialLoading = loading && items.length === 0 && expectedCount > 0;
  const { copiedKey, copy } = useCopyFeedback();

  return (
    <AdminDialog
      isOpen={isOpen}
      title='注册管理'
      onClose={onClose}
      panelClassName='max-w-2xl max-h-[85vh] overflow-y-auto'
    >
      <div className='space-y-6'>
        <div
          className={`${ADMIN_PANEL_CLASS} divide-y divide-gray-200 dark:divide-white/[0.06]`}
        >
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
          {userGroupNames.length > 0 && (
            <div className='flex items-center justify-between gap-4 py-2 pl-4 pr-2'>
              <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                新用户默认用户组
              </p>
              <Select
                value={defaultUserGroup}
                onChange={onDefaultUserGroupChange}
                ariaLabel='新用户默认用户组'
                variant='pill'
                align='end'
                disabled={isSettingDefaultGroup}
                options={[
                  { value: '', label: '无' },
                  ...userGroupNames.map((name) => ({
                    value: name,
                    label: name,
                  })),
                ]}
              />
            </div>
          )}
          <ToggleRow
            title='LinuxDo 登录'
            addon={
              !linuxDoConfigured && (
                <span className='text-xs font-normal text-gray-500 dark:text-gray-400'>
                  环境变量未配置
                </span>
              )
            }
            checked={linuxDo.Enabled}
            disabled={
              isSettingLinuxDo || (!linuxDoConfigured && !linuxDo.Enabled)
            }
            label='切换 LinuxDo 登录'
            onToggle={onToggleLinuxDo}
          />
          {linuxDo.Enabled && (
            <div className='flex items-center justify-between gap-4 py-2 pl-4 pr-2'>
              <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                LinuxDo 最低信任等级
              </p>
              <Select
                value={String(linuxDo.MinTrustLevel)}
                onChange={(value) =>
                  onLinuxDoTrustLevelChange(Number(value) as LinuxDoTrustLevel)
                }
                ariaLabel='LinuxDo 最低信任等级'
                variant='pill'
                align='end'
                disabled={isSettingLinuxDo}
                options={LINUXDO_TRUST_LEVEL_OPTIONS}
              />
            </div>
          )}
        </div>

        <Section id='invite-generate-heading' title='生成邀请码'>
          <InviteCodeGenerator
            activeCount={activeCount}
            isCreating={isCreatingCode}
            onCreateCodes={onCreateCodes}
          />
        </Section>

        <Section
          id='invite-code-heading'
          title='邀请码'
          addon={
            <div className='flex items-center gap-3'>
              {!error && !initialLoading && (
                <span className='text-xs tabular-nums text-gray-500 dark:text-gray-400'>
                  共 {total} 个
                </span>
              )}
              {inactiveCount > 0 && (
                <button
                  type='button'
                  onClick={onPurgeInactiveCodes}
                  disabled={isPurgingCodes}
                  title='删除所有已过期和已用尽的邀请码'
                  className='inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-200 transition-colors hover:bg-red-50 hover:text-red-600 hover:ring-red-200 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:ring-white/[0.08] dark:hover:bg-red-500/10 dark:hover:text-red-400 dark:hover:ring-red-500/30'
                >
                  {isPurgingCodes ? (
                    <Spinner className='h-3.5 w-3.5' />
                  ) : (
                    <Eraser className='h-3.5 w-3.5' />
                  )}
                  清理失效 {inactiveCount}
                </button>
              )}
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
            </div>
          }
        >
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
              <InviteCodeRowsSkeleton count={expectedCount} />
            ) : items.length === 0 ? (
              <p className='px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400'>
                {inviteFilter === 'all'
                  ? '还没有邀请码'
                  : '没有符合条件的邀请码'}
              </p>
            ) : (
              <ul
                aria-label='邀请码列表'
                className={`${INVITE_LIST_CLASS} overflow-y-auto`}
              >
                {items.map((item) => (
                  <InviteCodeRow
                    key={item.code}
                    item={item}
                    deleting={deletingCode === item.code}
                    copied={copiedKey === item.code}
                    onCopy={(code) => void copy(code, code)}
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
        </Section>
      </div>
    </AdminDialog>
  );
}
