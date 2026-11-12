'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import Select from '@/components/Select';
import {
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import {
  TrafficTabSkeleton,
  TrafficUsageCard,
} from '@/features/admin/components/tabs/traffic/TrafficUsageCard';
import { adminGet, adminPatch, adminPost } from '@/features/admin/lib/api';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';
import { showError, showSuccess } from '@/features/admin/lib/notifications';
import {
  type HostTrafficStatus,
  type TrafficRelayState,
  TRAFFIC_QUOTA_GB_MAX,
  TRAFFIC_RESET_DAY_MAX,
} from '@/lib/host-traffic';

interface TrafficPayload {
  settings: { QuotaGB: number; ResetDay: number };
  status: HostTrafficStatus;
}

const ENDPOINT = '/api/admin/traffic';

const RESET_DAY_OPTIONS = Array.from(
  { length: TRAFFIC_RESET_DAY_MAX },
  (_, index) => ({ label: `每月 ${index + 1} 号`, value: String(index + 1) }),
);

const RELAY_STATE: Record<
  TrafficRelayState,
  { label: string; pill: string; dot: string }
> = {
  active: {
    label: '正常',
    pill: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
    dot: 'bg-brand-500',
  },
  paused: {
    label: '已暂停',
    pill: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
    dot: 'bg-red-500',
  },
  resumed: {
    label: '已手动恢复',
    pill: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
};

function parseQuota(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const quota = Number(trimmed);
  return quota <= TRAFFIC_QUOTA_GB_MAX ? quota : null;
}

export default function TrafficTab() {
  const [data, setData] = useState<TrafficPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [quotaInput, setQuotaInput] = useState('');
  const [resetDay, setResetDay] = useState('1');
  const [saving, setSaving] = useState(false);
  const [relayUpdating, setRelayUpdating] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
  const busyRef = useRef(false);

  const applyPayload = useCallback((payload: TrafficPayload) => {
    setData(payload);
    setQuotaInput(
      payload.settings.QuotaGB > 0 ? String(payload.settings.QuotaGB) : '',
    );
    setResetDay(String(payload.settings.ResetDay));
  }, []);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      applyPayload(
        await adminGet<TrafficPayload>(ENDPOINT, '加载流量统计失败'),
      );
    } catch (error) {
      setFailed(true);
      showError(error, '加载流量统计失败');
    }
  }, [applyPayload]);

  useEffect(() => {
    void load();
  }, [load]);

  const quota = parseQuota(quotaInput);
  const dirty =
    !!data &&
    (quota !== data.settings.QuotaGB ||
      Number(resetDay) !== data.settings.ResetDay);

  const runExclusive = async (
    setBusy: (busy: boolean) => void,
    task: () => Promise<void>,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveSettings = () =>
    runExclusive(setSaving, async () => {
      if (quota === null) return;
      try {
        applyPayload(
          await adminPatch<TrafficPayload>(
            ENDPOINT,
            { QuotaGB: quota, ResetDay: Number(resetDay) },
            '保存流量设置失败',
          ),
        );
        showSuccess('流量设置已保存');
      } catch (error) {
        showError(error, '保存流量设置失败');
      }
    });

  const updateRelay = (relay: 'resume' | 'auto') =>
    runExclusive(setRelayUpdating, async () => {
      try {
        applyPayload(
          await adminPost<TrafficPayload>(
            ENDPOINT,
            { relay },
            '更新中转状态失败',
          ),
        );
        setConfirmResume(false);
        showSuccess(
          relay === 'resume' ? '服务器中转已恢复' : '已重新启用自动暂停',
        );
      } catch (error) {
        showError(error, '更新中转状态失败');
      }
    });

  if (!data) {
    if (failed) {
      return (
        <div className='flex justify-center py-16'>
          <button
            type='button'
            onClick={() => void load()}
            className={buttonStyles.outline}
          >
            重新加载
          </button>
        </div>
      );
    }
    return <TrafficTabSkeleton />;
  }

  const relay = RELAY_STATE[data.status.relay];

  return (
    <div className='space-y-6'>
      <TrafficUsageCard status={data.status} />

      <AdminSettingsGroup title='服务器中转'>
        <AdminSettingRow
          label='中转状态'
          labelAddon={
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${relay.pill}`}
            >
              <span
                aria-hidden='true'
                className={`h-1.5 w-1.5 rounded-full ${relay.dot}`}
              />
              {relay.label}
            </span>
          }
        >
          {data.status.relay === 'paused' && (
            <button
              type='button'
              disabled={relayUpdating}
              onClick={() => setConfirmResume(true)}
              className={buttonStyles.primary}
            >
              恢复中转
            </button>
          )}
          {data.status.relay === 'resumed' && (
            <button
              type='button'
              disabled={relayUpdating}
              onClick={() => void updateRelay('auto')}
              className={buttonStyles.outline}
            >
              重新启用自动暂停
            </button>
          )}
        </AdminSettingRow>
      </AdminSettingsGroup>

      <AdminSettingsGroup
        title='额度'
        actions={
          <button
            type='button'
            disabled={!dirty || quota === null || saving}
            onClick={() => void saveSettings()}
            className={`${buttonStyles.primary} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            保存
          </button>
        }
      >
        <AdminSettingRow label='月流量额度' htmlFor='traffic-quota'>
          <div className='relative w-40'>
            <input
              id='traffic-quota'
              inputMode='numeric'
              value={quotaInput}
              placeholder='不限'
              aria-invalid={quota === null}
              onChange={(event) => setQuotaInput(event.target.value)}
              className={`${inputStyles.base} w-full pr-10 tabular-nums ${
                quota === null ? 'ring-red-400 dark:ring-red-500' : ''
              }`}
            />
            <span className='pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-400'>
              GB
            </span>
          </div>
        </AdminSettingRow>
        <AdminSettingRow label='重置日' htmlFor='traffic-reset-day'>
          <Select
            id='traffic-reset-day'
            value={resetDay}
            onChange={setResetDay}
            options={RESET_DAY_OPTIONS}
            className='w-40'
          />
        </AdminSettingRow>
      </AdminSettingsGroup>

      <ConfirmModal
        isOpen={confirmResume}
        title='恢复服务器中转'
        message='恢复后本周期内不再自动暂停，流量可能超出额度。'
        confirmText='恢复'
        danger
        confirmDisabled={relayUpdating}
        onConfirm={() => updateRelay('resume')}
        onCancel={() => setConfirmResume(false)}
      />
    </div>
  );
}
