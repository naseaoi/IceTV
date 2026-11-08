'use client';

import { Check, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { LinuxDoIcon } from '@/components/LinuxDoIcon';
import Spinner from '@/components/Spinner';
import { getLinuxDoErrorMessage } from '@/lib/linuxdo-errors';
import { showToast } from '@/lib/toast';

type Binding = {
  bound: boolean;
  providerUsername: string | null;
  canUnbind: boolean;
};

// 不换行空格占住副标题行高，加载完成时卡片不跳动
const PLACEHOLDER_TEXT = String.fromCharCode(0xa0);

const TILE_CLASS =
  'flex h-14 min-w-0 items-center gap-2.5 rounded-xl px-3 ring-1 ring-inset transition-colors';

export function LinuxDoBindingTile() {
  const [binding, setBinding] = useState<Binding | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/linuxdo/binding')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Binding | null) => {
        if (active && data) setBinding(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function unbind() {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/linuxdo/binding', {
        method: 'DELETE',
      });
      if (res.ok) {
        setBinding({ bound: false, providerUsername: null, canUnbind: false });
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(
          data.error ||
            getLinuxDoErrorMessage(data.code ?? '') ||
            '解绑失败，请稍后重试',
          'error',
        );
      }
    } catch {
      showToast('网络错误，请稍后重试', 'error');
    } finally {
      setBusy(false);
    }
  }

  function bind() {
    setBusy(true);
    window.location.assign(
      `/api/auth/linuxdo?mode=bind&redirect=${encodeURIComponent(
        window.location.pathname + window.location.search,
      )}`,
    );
  }

  const label = (
    <span className='min-w-0 flex-1 text-left'>
      <span className='block text-sm font-medium leading-5 text-gray-900 dark:text-gray-100'>
        LinuxDo
      </span>
      <span className='block truncate text-xs leading-4 text-gray-500 dark:text-gray-400'>
        {binding === null
          ? PLACEHOLDER_TEXT
          : binding.bound
            ? binding.providerUsername || '已绑定'
            : '未绑定'}
      </span>
    </span>
  );

  if (binding?.bound) {
    return (
      <div
        className={`${TILE_CLASS} bg-brand-500/[0.06] ring-brand-500/25 dark:bg-brand-400/[0.08] dark:ring-brand-400/25`}
      >
        <LinuxDoIcon className='h-7 w-7 shrink-0' />
        {label}
        {binding.canUnbind ? (
          <button
            type='button'
            disabled={busy}
            onClick={unbind}
            className='shrink-0 rounded-md px-1.5 py-1 text-xs text-gray-500 transition-colors hover:text-rose-600 disabled:opacity-50 dark:text-gray-400 dark:hover:text-rose-400'
          >
            {busy ? <Spinner className='h-3.5 w-3.5' /> : '解绑'}
          </button>
        ) : (
          <Check
            className='h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400'
            aria-label='已绑定'
          />
        )}
      </div>
    );
  }

  return (
    <button
      type='button'
      disabled={binding === null || busy}
      onClick={bind}
      aria-label='绑定 LinuxDo 账号'
      className={`${TILE_CLASS} ring-gray-900/[0.08] hover:bg-gray-900/[0.03] disabled:cursor-default dark:ring-white/[0.08] dark:hover:bg-white/[0.04]`}
    >
      <LinuxDoIcon className='h-7 w-7 shrink-0' />
      {label}
      {busy ? (
        <Spinner className='h-4 w-4 shrink-0' />
      ) : (
        <Plus className='h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500' />
      )}
    </button>
  );
}
