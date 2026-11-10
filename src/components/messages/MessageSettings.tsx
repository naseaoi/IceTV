'use client';

import { useEffect, useRef, useState } from 'react';

import { OptionSwitchRow } from '@/components/OptionSwitchRow';
import {
  type MessageNotificationKind,
  MESSAGE_NOTIFICATION_KINDS,
} from '@/lib/message-types';
import {
  fetchMessageSettings,
  saveMessageSettings,
} from '@/lib/messages.client';
import { getErrorMessage } from '@/lib/user-facing-error';

const KIND_LABELS: Record<MessageNotificationKind, string> = {
  'tracking-update': '追更与收藏更新',
  'follow-review': '关注的人发布评价或年度报告',
  'review-reply': '评价回复',
  'new-follower': '新粉丝',
  'review-like': '评价被点赞',
};

export default function MessageSettings({ onSaved }: { onSaved: () => void }) {
  const [muted, setMutedState] = useState<MessageNotificationKind[] | null>(
    null,
  );
  // 连续点击在同一次渲染内发生时，闭包里的 muted 还是旧值，切换以 ref 中的最新值为准
  const mutedRef = useRef<MessageNotificationKind[] | null>(null);
  const [error, setError] = useState('');
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const latestSave = useRef(0);
  const confirmed = useRef<MessageNotificationKind[]>([]);
  const mounted = useRef(true);

  function setMuted(value: MessageNotificationKind[]) {
    mutedRef.current = value;
    setMutedState(value);
  }

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    fetchMessageSettings()
      .then((settings) => {
        if (!cancelled) {
          confirmed.current = settings.mutedKinds;
          setMuted(settings.mutedKinds);
        }
      })
      .catch(() => {
        if (!cancelled) setError('通知设置加载失败');
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);

  function toggle(kind: MessageNotificationKind) {
    const current = mutedRef.current;
    if (!current) return;
    const next = current.includes(kind)
      ? current.filter((item) => item !== kind)
      : [...current, kind];
    setMuted(next);
    setError('');
    const saveId = ++latestSave.current;
    // 连续切换按顺序提交，只采用最后一次请求的结果，避免先返回的旧结果把开关拨回去
    saving.current = saving.current
      .then(() => saveMessageSettings(next))
      .then((saved) => {
        confirmed.current = saved.mutedKinds;
        if (!mounted.current || saveId !== latestSave.current) return;
        setMuted(saved.mutedKinds);
        onSaved();
      })
      .catch((error) => {
        if (!mounted.current || saveId !== latestSave.current) return;
        setMuted(confirmed.current);
        setError(getErrorMessage(error, '保存失败，请重试'));
        void fetchMessageSettings()
          .then((settings) => {
            if (!mounted.current || saveId !== latestSave.current) return;
            confirmed.current = settings.mutedKinds;
            setMuted(settings.mutedKinds);
            onSaved();
          })
          .catch(() => undefined);
      });
  }

  return (
    <div className='-mx-3'>
      <h3 className='px-3 pb-1 text-xs font-semibold text-gray-500 dark:text-gray-400'>
        接收以下通知
      </h3>
      {MESSAGE_NOTIFICATION_KINDS.map((kind) => (
        <OptionSwitchRow
          key={kind}
          label={KIND_LABELS[kind]}
          checked={muted ? !muted.includes(kind) : false}
          pending={!muted}
          onChange={() => toggle(kind)}
        />
      ))}
      {error && (
        <p role='alert' className='px-3 pt-2 text-xs text-red-500'>
          {error}
        </p>
      )}
    </div>
  );
}
