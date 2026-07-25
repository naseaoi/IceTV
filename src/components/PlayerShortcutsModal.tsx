'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import ConfirmModal from '@/components/modals/ConfirmModal';
import ModalShell from '@/components/modals/ModalShell';
import {
  type PlayerShortcutAction,
  type PlayerShortcutMap,
  type PlayerShortcutMode,
  type ShortcutBinding,
  DEFAULT_PLAYER_SHORTCUTS,
  formatBinding,
  isPlayerShortcutActionEnabled,
  OPEN_PLAYER_SHORTCUTS_EVENT,
  PLAYER_SHORTCUT_ACTIONS,
  readPlayerShortcuts,
  setPlayerShortcutsSuspended,
  writePlayerShortcuts,
} from '@/lib/player-shortcuts';

const MODIFIER_KEYS = new Set(['Shift', 'Alt', 'Control', 'Meta']);

function bindingFromEvent(event: KeyboardEvent): ShortcutBinding | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  return {
    key: event.key === 'Spacebar' ? ' ' : event.key,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
  };
}

function findConflict(
  map: PlayerShortcutMap,
  action: PlayerShortcutAction,
  binding: ShortcutBinding,
): PlayerShortcutAction | null {
  for (const other of Object.keys(map) as PlayerShortcutAction[]) {
    if (other === action) continue;
    const b = map[other];
    if (
      b.key.toLowerCase() === binding.key.toLowerCase() &&
      !!b.shiftKey === !!binding.shiftKey &&
      !!b.altKey === !!binding.altKey &&
      !!b.ctrlKey === !!binding.ctrlKey
    ) {
      return other;
    }
  }
  return null;
}

interface PlayerShortcutsModalProps {
  mode?: PlayerShortcutMode;
}

export default function PlayerShortcutsModal({
  mode = 'vod',
}: PlayerShortcutsModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<PlayerShortcutMap>(
    DEFAULT_PLAYER_SHORTCUTS,
  );
  const [recording, setRecording] = useState<PlayerShortcutAction | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const availableActions = PLAYER_SHORTCUT_ACTIONS.filter(({ action }) =>
    isPlayerShortcutActionEnabled(mode, action),
  );

  useEffect(() => {
    const handleOpen = () => {
      setDraft(readPlayerShortcuts());
      setRecording(null);
      setConflict(null);
      setIsOpen(true);
    };
    window.addEventListener(OPEN_PLAYER_SHORTCUTS_EVENT, handleOpen);
    return () => {
      window.removeEventListener(OPEN_PLAYER_SHORTCUTS_EVENT, handleOpen);
    };
  }, []);

  useEffect(() => {
    setPlayerShortcutsSuspended(isOpen);
    return () => setPlayerShortcutsSuspended(false);
  }, [isOpen]);

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setRecording(null);
        return;
      }

      const binding = bindingFromEvent(event);
      if (!binding) return;

      const conflictAction = findConflict(draft, recording, binding);
      if (conflictAction) {
        const label = PLAYER_SHORTCUT_ACTIONS.find(
          (a) => a.action === conflictAction,
        )?.label;
        setConflict(`该按键已被「${label}」占用`);
        return;
      }

      setDraft((prev) => ({ ...prev, [recording]: binding }));
      setConflict(null);
      setRecording(null);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, draft]);

  const handleClose = useCallback(() => {
    if (showResetConfirm) return;
    setIsOpen(false);
    setRecording(null);
  }, [showResetConfirm]);

  const handleSave = useCallback(() => {
    writePlayerShortcuts(draft);
    setIsOpen(false);
    setRecording(null);
  }, [draft]);

  const handleReset = useCallback(() => {
    setDraft((current) => {
      const next = { ...current };
      PLAYER_SHORTCUT_ACTIONS.forEach(({ action }) => {
        if (isPlayerShortcutActionEnabled(mode, action)) {
          next[action] = { ...DEFAULT_PLAYER_SHORTCUTS[action] };
        }
      });
      return next;
    });
    setConflict(null);
    setRecording(null);
    setShowResetConfirm(false);
  }, [mode]);

  return (
    <ModalShell isOpen={isOpen} onClose={handleClose} panelClassName='max-w-lg'>
      <div className='p-6'>
        <div className='mb-6 flex items-start justify-between'>
          <div>
            <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
              快捷键配置
            </h3>
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              点击右侧按键后按下新的键位即可修改，按 Esc 取消录制
            </p>
          </div>
          <button
            onClick={handleClose}
            className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200'
            title='关闭'
            aria-label='关闭'
          >
            <X className='h-4 w-4' />
          </button>
        </div>

        {conflict && (
          <div className='mb-3 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'>
            {conflict}
          </div>
        )}

        <div className='scrollbar-visible max-h-[45vh] space-y-1 overflow-y-auto pr-2'>
          {availableActions.map(({ action, label }) => (
            <div
              key={action}
              className='flex items-center justify-between rounded-lg px-3 py-2 hover:bg-gray-100/70 dark:hover:bg-white/[0.04]'
            >
              <span className='text-sm text-gray-700 dark:text-gray-200'>
                {label}
              </span>
              <button
                onClick={() => {
                  setConflict(null);
                  setRecording(action);
                }}
                className={`min-w-[92px] rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  recording === action
                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-blue-400 dark:border-white/10 dark:bg-gray-800/70 dark:text-gray-200'
                }`}
              >
                {recording === action
                  ? '请按键…'
                  : formatBinding(draft[action])}
              </button>
            </div>
          ))}
        </div>

        <div className='mt-6 flex justify-end gap-3'>
          <button
            onClick={() => setShowResetConfirm(true)}
            className='rounded-lg border border-red-200/70 bg-white px-5 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-400/20 dark:bg-gray-800/70 dark:text-red-400 dark:hover:bg-red-900/20'
          >
            重置
          </button>
          <button
            onClick={handleSave}
            className='rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700'
          >
            保存
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={showResetConfirm}
        title='确认恢复默认快捷键？'
        message={
          mode === 'live'
            ? '该操作会将直播页可用的快捷键重置为默认键位，保存后生效。'
            : '该操作会将所有快捷键重置为默认键位，保存后生效。'
        }
        danger
        cancelText='取消'
        confirmText='确认恢复'
        onCancel={() => setShowResetConfirm(false)}
        onConfirm={handleReset}
      />
    </ModalShell>
  );
}
