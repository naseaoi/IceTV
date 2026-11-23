'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { adminGet, adminPost } from '@/features/admin/lib/api';
import type { UpdaterPhase, UpgradeResponse } from '@/features/upgrade/types';
import { DisplayableError, getErrorMessage } from '@/lib/user-facing-error';
import { CURRENT_VERSION } from '@/lib/version';

const ENDPOINT = '/api/admin/upgrade';
const POLL_INTERVAL_MS = 2000;
// 新容器健康检查最长约 4 分钟，加上回退留出余量
const RESTART_TIMEOUT_MS = 8 * 60 * 1000;
const ACTIVE_PHASES: readonly UpdaterPhase[] = [
  'pulling',
  'restarting',
  'verifying',
  'rolling-back',
];

export type WebUpgradeView =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'upgrade' }
  | { kind: 'pulling' }
  | { kind: 'restart'; pulledVersion: string | null }
  | { kind: 'restarting' }
  | { kind: 'refresh' };

export interface WebUpgradeState {
  view: WebUpgradeView;
  notice: string | null;
  error: string | null;
  submitting: boolean;
  pull: () => Promise<void>;
  restart: () => Promise<void>;
}

function isUpgradeResponse(value: unknown): value is UpgradeResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { available?: unknown }).available === 'boolean'
  );
}

export function useWebUpgrade(enabled: boolean): WebUpgradeState {
  const [response, setResponse] = useState<UpgradeResponse | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  const [restartStartedAt, setRestartStartedAt] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const awaitingRestartRef = useRef(false);

  useEffect(() => {
    awaitingRestartRef.current = restartStartedAt !== null;
  }, [restartStartedAt]);

  const loadStatus = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await adminGet<unknown>(
        ENDPOINT,
        '获取升级状态失败',
        signal,
      );
      if (!isUpgradeResponse(data)) throw new Error('Invalid upgrade response');
      // 重启窗口里旧服务已停、新服务可能尚未接入升级服务，不把这段空档当作不可用
      if (awaitingRestartRef.current && !data.available) return;
      setResponse(data);
    } catch {
      // 重启期间服务不可达属预期；其余情况保持原状，界面回落到「前往更新」
    } finally {
      if (!signal?.aborted) setStatusChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadStatus(controller.signal);
    return () => controller.abort();
  }, [enabled, loadStatus]);

  const phase = response?.available === true ? response.status.job.phase : null;
  const awaitingRestart = restartStartedAt !== null;
  const polling =
    enabled &&
    (awaitingRestart || (phase !== null && ACTIVE_PHASES.includes(phase)));

  useEffect(() => {
    if (!polling) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void loadStatus(controller.signal);
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [polling, loadStatus]);

  useEffect(() => {
    if (restartStartedAt === null) return;
    if (phase === 'succeeded') {
      window.location.reload();
      return;
    }
    if (phase === 'rolled-back' || phase === 'failed') {
      setRestartStartedAt(null);
      return;
    }
    const remaining = restartStartedAt + RESTART_TIMEOUT_MS - Date.now();
    const timer = window.setTimeout(
      () => {
        setRestartStartedAt(null);
        setActionError('等待重启超时，请到服务器检查容器状态');
      },
      Math.max(remaining, 0),
    );
    return () => window.clearTimeout(timer);
  }, [phase, restartStartedAt]);

  const submit = useCallback(
    async (action: 'pull' | 'restart') => {
      setSubmitting(true);
      setActionError(null);
      try {
        const data = await adminPost<unknown>(
          ENDPOINT,
          { action },
          action === 'pull' ? '升级失败' : '重启失败',
        );
        if (isUpgradeResponse(data)) setResponse(data);
        if (action === 'restart') setRestartStartedAt(Date.now());
      } catch (error) {
        // 容器可能在响应送达前就被停止，网络中断视为重启已开始，交给轮询确认结果
        if (action === 'restart' && !(error instanceof DisplayableError)) {
          setRestartStartedAt(Date.now());
          return;
        }
        setActionError(
          getErrorMessage(error, action === 'pull' ? '升级失败' : '重启失败'),
        );
        void loadStatus();
      } finally {
        setSubmitting(false);
      }
    },
    [loadStatus],
  );

  const pull = useCallback(() => submit('pull'), [submit]);
  const restart = useCallback(() => submit('restart'), [submit]);

  let view: WebUpgradeView =
    enabled && !statusChecked ? { kind: 'checking' } : { kind: 'unavailable' };
  let notice: string | null = null;
  let jobError: string | null = null;
  if (awaitingRestart) {
    view = { kind: 'restarting' };
  } else if (response?.available) {
    const { job, target } = response.status;
    switch (job.phase) {
      case 'pulling':
        view = { kind: 'pulling' };
        break;
      case 'pulled':
        view = { kind: 'restart', pulledVersion: job.pulledVersion ?? null };
        break;
      case 'restarting':
      case 'verifying':
      case 'rolling-back':
        view = { kind: 'restarting' };
        break;
      case 'succeeded':
        view =
          target?.currentVersion && target.currentVersion !== CURRENT_VERSION
            ? { kind: 'refresh' }
            : { kind: 'upgrade' };
        break;
      default:
        view = { kind: 'upgrade' };
    }
    if (job.phase === 'up-to-date') {
      notice = '新版本镜像尚未发布，请稍后再试';
    }
    if (job.phase === 'rolled-back' || job.phase === 'failed') {
      const base =
        job.message ||
        (job.phase === 'rolled-back'
          ? '新版本启动失败，已恢复到原版本'
          : '升级失败，请到服务器检查容器状态');
      jobError = response.backupPath
        ? `${base}。升级前的数据库备份：${response.backupPath}`
        : base;
    }
  }

  return {
    view,
    notice,
    error: actionError ?? jobError,
    submitting,
    pull,
    restart,
  };
}
