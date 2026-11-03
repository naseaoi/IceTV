'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_INPUT_CLASS,
  MODAL_LABEL_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import { useNicknameAvailability } from '@/hooks/useNicknameAvailability';
import { getMyProfile, updateProfile } from '@/lib/profile.client';
import { NICKNAME_RULE_MESSAGE, validateNickname } from '@/lib/user-profile';

export function ProfileForm({
  required = false,
  onSaved,
  onClose,
}: {
  required?: boolean;
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const { session, refreshSession } = useAuthSession();
  const [nickname, setNickname] = useState(
    session.status === 'authenticated' ? (session.nickname ?? '') : '',
  );
  const [favoritesPublic, setFavoritesPublic] = useState(false);
  const [loaded, setLoaded] = useState(required);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const availability = useNicknameAvailability(nickname);
  useEffect(() => {
    if (required) return;
    let active = true;
    getMyProfile()
      .then((profile) => {
        if (active) {
          setNickname(profile.nickname ?? '');
          setFavoritesPublic(profile.favoritesPublic);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setError('资料加载失败，请关闭后重试');
      });
    return () => {
      active = false;
    };
  }, [required]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !loaded || availability.status !== 'available') return;
    setSaving(true);
    setError('');
    try {
      const valid = validateNickname(nickname);
      await updateProfile({
        nickname: valid.nickname,
        ...(!required ? { favoritesPublic } : {}),
      });
      await refreshSession();
      onSaved?.();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={save}>
      <div className='flex items-center justify-between gap-3'>
        <h2 className={MODAL_TITLE_CLASS}>
          {required ? '设置你的昵称' : '个人资料'}
        </h2>
        {onClose && (
          <button
            type='button'
            aria-label='关闭资料面板'
            onClick={onClose}
            className={`${MODAL_CLOSE_BUTTON_CLASS} -mr-1.5`}
          >
            <X className='h-4 w-4' />
          </button>
        )}
      </div>
      {required && (
        <p className='mt-1.5 text-sm leading-6 text-gray-500 dark:text-gray-400'>
          昵称会公开显示在评价和个人主页，登录名不会公开
        </p>
      )}
      <div className='mt-5'>
        <label htmlFor='profile-nickname' className={MODAL_LABEL_CLASS}>
          昵称
        </label>
        <input
          id='profile-nickname'
          autoComplete='nickname'
          value={nickname}
          disabled={saving || !loaded}
          onChange={(event) => setNickname(event.target.value)}
          className={MODAL_INPUT_CLASS}
        />
        <p
          role='status'
          className={`mt-1.5 min-h-[1rem] text-xs ${
            availability.status === 'error'
              ? 'text-rose-600 dark:text-rose-400'
              : availability.status === 'available'
                ? 'text-brand-600 dark:text-brand-400'
                : 'text-gray-400 dark:text-gray-500'
          }`}
        >
          {availability.message || NICKNAME_RULE_MESSAGE}
        </p>
      </div>
      {!required && (
        <button
          type='button'
          role='switch'
          aria-checked={favoritesPublic}
          disabled={!loaded || saving}
          onClick={() => setFavoritesPublic(!favoritesPublic)}
          className='mt-4 flex w-full items-center justify-between gap-4 border-t border-gray-200/70 pt-4 text-left text-sm text-gray-900 disabled:opacity-60 dark:border-white/[0.06] dark:text-gray-100'
        >
          <span>公开我的收藏</span>
          <span
            aria-hidden='true'
            className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
              favoritesPublic
                ? 'bg-brand-500'
                : 'bg-gray-200 dark:bg-white/[0.12]'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                favoritesPublic ? 'translate-x-4' : ''
              }`}
            />
          </span>
        </button>
      )}
      {error && (
        <p
          role='alert'
          className='mt-4 text-sm text-rose-600 dark:text-rose-400'
        >
          {error}
        </p>
      )}
      <div className='mt-6 flex items-center justify-between gap-3'>
        {!required && session.status === 'authenticated' ? (
          <Link
            href={`/u/${session.profileId}`}
            onClick={onSaved}
            className='text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
          >
            查看我的主页
          </Link>
        ) : (
          <span />
        )}
        <button
          type='submit'
          disabled={saving || !loaded || availability.status !== 'available'}
          className={MODAL_PRIMARY_BUTTON_CLASS}
        >
          {saving ? '保存中…' : '保存资料'}
        </button>
      </div>
    </form>
  );
}

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell isOpen onClose={onClose} panelClassName='max-w-sm p-5 sm:p-6'>
      <div role='dialog' aria-label='个人资料' aria-modal='true'>
        <ProfileForm onSaved={onClose} onClose={onClose} />
      </div>
    </ModalShell>
  );
}
