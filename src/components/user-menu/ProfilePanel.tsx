'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import ModalShell from '@/components/modals/ModalShell';
import { useNicknameAvailability } from '@/hooks/useNicknameAvailability';
import { getMyProfile, updateProfile } from '@/lib/profile.client';
import { NICKNAME_RULE_MESSAGE, validateNickname } from '@/lib/user-profile';

export function ProfileForm({
  required = false,
  onSaved,
}: {
  required?: boolean;
  onSaved?: () => void;
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
    <form onSubmit={save} className='space-y-5'>
      <div>
        <h2 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
          {required ? '设置你的昵称' : '个人资料'}
        </h2>
        <p className='mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400'>
          昵称会公开显示在评价和个人主页，登录名不会公开
        </p>
      </div>
      <div>
        <label htmlFor='profile-nickname' className='text-sm font-medium'>
          昵称
        </label>
        <input
          id='profile-nickname'
          autoComplete='nickname'
          value={nickname}
          disabled={saving || !loaded}
          onChange={(event) => setNickname(event.target.value)}
          className='mt-2 w-full rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-gray-900 focus:ring-2 focus:ring-green-500 dark:bg-white/10 dark:text-gray-100'
        />
        <p className='mt-2 text-xs text-gray-500'>{NICKNAME_RULE_MESSAGE}</p>
        <p
          role='status'
          className={`mt-1 text-xs ${availability.status === 'error' ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}
        >
          {availability.message}
        </p>
      </div>
      {!required && (
        <button
          type='button'
          role='switch'
          aria-checked={favoritesPublic}
          disabled={!loaded || saving}
          onClick={() => setFavoritesPublic(!favoritesPublic)}
          className='flex w-full items-center justify-between rounded-xl bg-gray-50 p-3 text-sm dark:bg-white/5'
        >
          <span>公开我的收藏</span>
          <span
            className={`rounded-full px-3 py-1 ${favoritesPublic ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
          >
            {favoritesPublic ? '已开启' : '已关闭'}
          </span>
        </button>
      )}
      {error && (
        <p role='alert' className='text-sm text-red-500'>
          {error}
        </p>
      )}
      <div className='flex items-center justify-between gap-3'>
        <button
          type='submit'
          disabled={saving || !loaded || availability.status !== 'available'}
          className='rounded-xl bg-green-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50'
        >
          {saving ? '保存中…' : '保存资料'}
        </button>
        {!required && session.status === 'authenticated' && (
          <Link
            href={`/u/${session.profileId}`}
            onClick={onSaved}
            className='text-sm text-green-600 dark:text-green-400'
          >
            查看我的主页
          </Link>
        )}
      </div>
    </form>
  );
}

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell isOpen onClose={onClose} panelClassName='max-w-md p-6'>
      <div role='dialog' aria-label='个人资料' aria-modal='true'>
        <button
          type='button'
          aria-label='关闭资料面板'
          onClick={onClose}
          className='float-right rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10'
        >
          <X className='h-5 w-5' />
        </button>
        <ProfileForm onSaved={onClose} />
      </div>
    </ModalShell>
  );
}
