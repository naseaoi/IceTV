'use client';

import { KeyRound, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAuthSession } from '@/components/AuthProvider';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_INPUT_CLASS,
  MODAL_LABEL_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import ProfileAvatar from '@/components/ProfileAvatar';
import Select from '@/components/Select';
import { useNicknameAvailability } from '@/hooks/useNicknameAvailability';
import { getMyProfile, updateProfile } from '@/lib/profile.client';
import { showToast } from '@/lib/toast';
import type { LibraryVisibility } from '@/lib/types';
import {
  createAvatarSeed,
  NICKNAME_MAX_LENGTH,
  validateNickname,
} from '@/lib/user-profile';

const AVATAR_CANDIDATE_COUNT = 5;

function createCandidates() {
  return Array.from({ length: AVATAR_CANDIDATE_COUNT }, createAvatarSeed);
}

type SavedProfile = {
  nickname: string;
  avatarSeed: string | null;
  libraryVisibility: LibraryVisibility;
};

export function ProfileForm({
  required = false,
  onSaved,
  onClose,
  onChangePassword,
}: {
  required?: boolean;
  onSaved?: () => void;
  onClose?: () => void;
  onChangePassword?: () => void;
}) {
  const { session, refreshSession } = useAuthSession();
  const profileId = session.status === 'authenticated' ? session.profileId : '';
  const allowReserved =
    session.status === 'authenticated' && session.role === 'owner';
  const [saved, setSaved] = useState<SavedProfile>(() => ({
    nickname:
      session.status === 'authenticated' ? (session.nickname ?? '') : '',
    avatarSeed: session.status === 'authenticated' ? session.avatarSeed : null,
    libraryVisibility: 0,
  }));
  const [nickname, setNickname] = useState(saved.nickname);
  const [avatarSeed, setAvatarSeed] = useState(saved.avatarSeed);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [libraryVisibility, setLibraryVisibility] =
    useState<LibraryVisibility>(0);
  const [loaded, setLoaded] = useState(required);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const trimmedNickname = nickname.normalize('NFKC').trim();
  const nicknameChanged = trimmedNickname !== saved.nickname;
  const availability = useNicknameAvailability(
    nickname,
    nicknameChanged,
    allowReserved,
  );
  const nicknameReady = nicknameChanged
    ? availability.status === 'available'
    : trimmedNickname !== '';
  const dirty =
    nicknameChanged ||
    avatarSeed !== saved.avatarSeed ||
    libraryVisibility !== saved.libraryVisibility;
  const canSave = loaded && !saving && nicknameReady && dirty;
  const nicknameLength = Array.from(trimmedNickname).length;

  useEffect(() => {
    setCandidates(createCandidates());
  }, []);

  useEffect(() => {
    if (required) return;
    let active = true;
    getMyProfile()
      .then((profile) => {
        if (!active) return;
        const next = {
          nickname: profile.nickname ?? '',
          avatarSeed: profile.avatarSeed,
          libraryVisibility: profile.libraryVisibility,
        };
        setSaved(next);
        setNickname(next.nickname);
        setAvatarSeed(next.avatarSeed);
        setLibraryVisibility(next.libraryVisibility);
        setLoaded(true);
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
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await updateProfile({
        ...(nicknameChanged
          ? {
              nickname: validateNickname(nickname, { allowReserved }).nickname,
            }
          : {}),
        ...(avatarSeed !== saved.avatarSeed ? { avatarSeed } : {}),
        ...(!required && libraryVisibility !== saved.libraryVisibility
          ? { libraryVisibility }
          : {}),
      });
      await refreshSession();
      showToast('个人资料已保存', 'success');
      onSaved?.();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const statusClass =
    availability.status === 'error'
      ? 'text-rose-600 dark:text-rose-400'
      : availability.status === 'available'
        ? 'text-brand-600 dark:text-brand-400'
        : 'text-gray-400 dark:text-gray-500';
  const avatarOptions = [saved.avatarSeed, ...candidates];

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

      <div className='mt-5 flex flex-col items-center'>
        <ProfileAvatar user={{ profileId, avatarSeed }} className='h-20 w-20' />
        <div
          role='radiogroup'
          aria-label='选择头像'
          className='mt-4 flex items-center gap-2'
        >
          {avatarOptions.map((seed, index) => {
            const selected = seed === avatarSeed;
            return (
              <button
                key={seed ?? 'current'}
                type='button'
                role='radio'
                aria-checked={selected}
                aria-label={index === 0 ? '当前头像' : `候选头像 ${index}`}
                disabled={saving}
                onClick={() => setAvatarSeed(seed)}
                className={`rounded-full p-0.5 ring-2 transition ${
                  selected
                    ? 'ring-brand-500'
                    : 'ring-transparent hover:ring-gray-300 dark:hover:ring-white/20'
                }`}
              >
                <ProfileAvatar
                  user={{ profileId, avatarSeed: seed }}
                  className='h-8 w-8'
                />
              </button>
            );
          })}
          <button
            type='button'
            aria-label='换一批头像'
            disabled={saving}
            onClick={() =>
              setCandidates((previous) =>
                createCandidates().map((seed, index) =>
                  previous[index] === avatarSeed ? previous[index] : seed,
                ),
              )
            }
            className={`${MODAL_CLOSE_BUTTON_CLASS} ml-1 h-9 w-9 bg-gray-900/[0.04] dark:bg-white/[0.06]`}
          >
            <RefreshCw className='h-4 w-4' />
          </button>
        </div>
      </div>

      <div className='mt-6'>
        <label htmlFor='profile-nickname' className={MODAL_LABEL_CLASS}>
          昵称
        </label>
        <div className='relative'>
          <input
            id='profile-nickname'
            autoComplete='nickname'
            value={nickname}
            disabled={saving || !loaded}
            onChange={(event) => setNickname(event.target.value)}
            className={`${MODAL_INPUT_CLASS} pr-14`}
          />
          <span
            aria-hidden='true'
            className={`pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs tabular-nums ${
              nicknameLength > NICKNAME_MAX_LENGTH
                ? 'text-rose-500'
                : 'text-gray-400 dark:text-gray-500'
            }`}
          >
            {nicknameLength}/{NICKNAME_MAX_LENGTH}
          </span>
        </div>
        <p
          role='status'
          className={`mt-1.5 min-h-[1rem] text-xs ${statusClass}`}
        >
          {availability.message}
        </p>
      </div>

      {!required && (
        <div className='mt-2'>
          <label htmlFor='profile-visibility' className={MODAL_LABEL_CLASS}>
            收藏公开范围
          </label>
          <Select
            id='profile-visibility'
            ariaLabel='收藏公开范围'
            variant='field'
            value={String(libraryVisibility)}
            disabled={!loaded || saving}
            onChange={(value) =>
              setLibraryVisibility(Number(value) as LibraryVisibility)
            }
            options={[
              { value: '0', label: '不公开' },
              { value: '1', label: '仅片单' },
              { value: '2', label: '片单与观看状态' },
              { value: '3', label: '片单、状态与评分' },
            ]}
          />
        </div>
      )}

      {error && (
        <p
          role='alert'
          className='mt-4 text-sm text-rose-600 dark:text-rose-400'
        >
          {error}
        </p>
      )}

      <div className='mt-6 flex items-center justify-end gap-2'>
        {onChangePassword && (
          <button
            type='button'
            onClick={onChangePassword}
            className='-ml-2 mr-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
          >
            <KeyRound className='h-4 w-4' />
            修改密码
          </button>
        )}
        {onClose && (
          <button
            type='button'
            onClick={onClose}
            className={MODAL_SECONDARY_BUTTON_CLASS}
          >
            取消
          </button>
        )}
        <button
          type='submit'
          disabled={!canSave}
          className={MODAL_PRIMARY_BUTTON_CLASS}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}

export function ProfilePanel({
  onClose,
  onChangePassword,
}: {
  onClose: () => void;
  onChangePassword?: () => void;
}) {
  return (
    <ModalShell isOpen onClose={onClose} panelClassName='max-w-sm p-5 sm:p-6'>
      <div role='dialog' aria-label='个人资料' aria-modal='true'>
        <ProfileForm
          onSaved={onClose}
          onClose={onClose}
          onChangePassword={onChangePassword}
        />
      </div>
    </ModalShell>
  );
}
