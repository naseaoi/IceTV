'use client';

import { PenLine, Plus, Search, X } from 'lucide-react';
import Link from 'next/link';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

import CoverImage from '@/components/CoverImage';
import LoadErrorState from '@/components/LoadErrorState';
import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_INPUT_CLASS,
  MODAL_PRIMARY_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
  MODAL_TITLE_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell, { useDeferredClose } from '@/components/modals/ModalShell';
import { getAllFavorites, getCachedFavoritesSnapshot } from '@/lib/db.client';
import { updateProfile } from '@/lib/profile.client';
import type { Favorite, ProfileShowcaseItem } from '@/lib/types';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';
import { SHOWCASE_MAX_ITEMS } from '@/lib/user-profile';

export const SHOWCASE_GRID_CLASS =
  'grid max-w-md grid-cols-3 gap-3 sm:gap-4 lg:max-w-none lg:gap-3';
export const SHOWCASE_COVER_CLASS =
  'relative aspect-[2/3] overflow-hidden rounded-xl';
export const SHOWCASE_TITLE_CLASS = 'mt-1.5 text-xs leading-4 sm:text-[13px]';
export const SHOWCASE_HEADER_CLASS = 'flex h-7 items-center justify-between';
export const SECTION_LABEL_CLASS =
  'text-xs font-medium tracking-wider text-gray-400 dark:text-gray-500';
const PICKER_SKELETON_LIMIT = 20;

export function showcasePlayUrl(item: { title: string; year: string }) {
  return `/play?${new URLSearchParams({ title: item.title, year: item.year })}`;
}

export function ProfileShowcase({
  items,
  isSelf,
  favoriteCount,
  onChange,
}: {
  items: ProfileShowcaseItem[];
  isSelf: boolean;
  favoriteCount: number;
  onChange: (items: ProfileShowcaseItem[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const isEmpty = items.length === 0;
  // 空位始终补满：本人可点击挑选，他人显示空白封面框
  const emptySlots = SHOWCASE_MAX_ITEMS - items.length;

  return (
    <section aria-labelledby='profile-showcase-title'>
      <div className={`mb-3 ${SHOWCASE_HEADER_CLASS}`}>
        <h2 id='profile-showcase-title' className={SECTION_LABEL_CLASS}>
          本命
        </h2>
        {!isSelf && isEmpty && <span className='sr-only'>暂无</span>}
        {isSelf && !isEmpty && (
          <button
            type='button'
            aria-label='编辑本命作品'
            onClick={() => setPicking(true)}
            className={`${MODAL_CLOSE_BUTTON_CLASS} -mr-1.5 h-7 w-7`}
          >
            <PenLine aria-hidden='true' className='h-3.5 w-3.5' />
          </button>
        )}
      </div>
      <ul className={`motion-stagger ${SHOWCASE_GRID_CLASS}`}>
        {items.map((item, index) => (
          <li
            key={item.key}
            className='min-w-0'
            style={{ '--stagger-index': index } as CSSProperties}
          >
            <Link
              href={showcasePlayUrl(item)}
              aria-label={`播放${item.title}`}
              className='group block'
            >
              <div
                className={`${SHOWCASE_COVER_CLASS} bg-gray-100 shadow-sm ring-1 ring-black/5 transition duration-300 group-hover:-translate-y-1 group-hover:shadow-lg dark:bg-gray-800 dark:ring-white/10`}
              >
                <CoverImage
                  src={item.cover}
                  alt={item.title}
                  sizes='(max-width: 640px) 25vw, 200px'
                />
              </div>
              <p
                className={`${SHOWCASE_TITLE_CLASS} truncate text-gray-700 group-hover:text-gray-900 dark:text-gray-300 dark:group-hover:text-white`}
              >
                {item.title}
              </p>
            </Link>
          </li>
        ))}
        {Array.from({ length: emptySlots }, (_, index) => (
          <li
            key={`empty-${index}`}
            aria-hidden={isSelf ? undefined : true}
            className='min-w-0'
          >
            {isSelf ? (
              <button
                type='button'
                aria-label='挑选本命作品'
                onClick={() => setPicking(true)}
                className={`${SHOWCASE_COVER_CLASS} flex w-full items-center justify-center border border-dashed border-gray-300 text-gray-300 transition hover:border-brand-400 hover:text-brand-500 dark:border-white/15 dark:text-gray-600 dark:hover:border-brand-400 dark:hover:text-brand-400`}
              >
                <Plus aria-hidden='true' className='h-5 w-5' />
              </button>
            ) : (
              <div
                className={`${SHOWCASE_COVER_CLASS} border border-dashed border-gray-200 dark:border-white/10`}
              />
            )}
            <p aria-hidden='true' className={SHOWCASE_TITLE_CLASS}>
              &nbsp;
            </p>
          </li>
        ))}
      </ul>
      {picking && (
        <ShowcasePicker
          initialKeys={items.map((item) => item.key)}
          favoriteCount={favoriteCount}
          onClose={() => setPicking(false)}
          onSaved={onChange}
        />
      )}
    </section>
  );
}

type PickerEntry = { key: string; favorite: Favorite };

function toEntries(favorites: Record<string, Favorite>): PickerEntry[] {
  return Object.entries(favorites)
    .filter(([, favorite]) => favorite.origin !== 'live')
    .map(([key, favorite]) => ({ key, favorite }))
    .sort((a, b) => b.favorite.save_time - a.favorite.save_time);
}

function ShowcasePicker({
  initialKeys,
  favoriteCount,
  onClose,
  onSaved,
}: {
  initialKeys: string[];
  favoriteCount: number;
  onClose: () => void;
  onSaved: (items: ProfileShowcaseItem[]) => void;
}) {
  const [open, requestClose] = useDeferredClose(onClose);
  const [entries, setEntries] = useState<PickerEntry[] | null>(() => {
    const snapshot = getCachedFavoritesSnapshot();
    return snapshot ? toEntries(snapshot) : null;
  });
  const [loadFailed, setLoadFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState(initialKeys);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    getAllFavorites()
      .then((favorites) => active && setEntries(toEntries(favorites)))
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, [version]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!entries || !keyword) return entries;
    return entries.filter(({ favorite }) =>
      favorite.title.toLowerCase().includes(keyword),
    );
  }, [entries, query]);

  const full = selected.length >= SHOWCASE_MAX_ITEMS;
  const changed =
    selected.length !== initialKeys.length ||
    selected.some((key, index) => key !== initialKeys[index]);

  function toggle(key: string) {
    setSelected((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : current.length >= SHOWCASE_MAX_ITEMS
          ? current
          : [...current, key],
    );
  }

  async function save() {
    if (!changed || saving) return;
    setSaving(true);
    setError('');
    try {
      const profile = await updateProfile({ showcaseKeys: selected });
      onSaved(profile.showcase);
      requestClose();
    } catch (error) {
      if (!isAbortError(error))
        setError(getErrorMessage(error, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }

  const skeletonCount = Math.min(
    Math.max(favoriteCount, 0),
    PICKER_SKELETON_LIMIT,
  );

  return (
    <ModalShell
      isOpen={open}
      onClose={requestClose}
      panelClassName='flex max-h-[min(42rem,calc(100dvh-2rem))] max-w-xl flex-col overflow-hidden'
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='showcase-picker-title'
        className='flex min-h-0 flex-1 flex-col'
      >
        <div className='flex items-center justify-between gap-3 px-5 pt-5'>
          <div className='flex items-baseline gap-2'>
            <h2 id='showcase-picker-title' className={MODAL_TITLE_CLASS}>
              挑选本命
            </h2>
            <span
              aria-label={`已选 ${selected.length} 部，最多 ${SHOWCASE_MAX_ITEMS} 部`}
              className='text-sm tabular-nums text-gray-400'
            >
              {selected.length}/{SHOWCASE_MAX_ITEMS}
            </span>
          </div>
          <button
            type='button'
            aria-label='关闭'
            onClick={requestClose}
            className={`-mr-1.5 ${MODAL_CLOSE_BUTTON_CLASS}`}
          >
            <X className='h-4 w-4' />
          </button>
        </div>
        <div className='relative mx-5 mb-3 mt-4'>
          <Search
            aria-hidden='true'
            className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400'
          />
          <input
            type='search'
            aria-label='搜索收藏'
            placeholder='搜索收藏'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={`${MODAL_INPUT_CLASS} pl-9`}
          />
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-1'>
          {loadFailed && !entries ? (
            <LoadErrorState onRetry={() => setVersion((value) => value + 1)} />
          ) : !visible ? (
            <div
              role='status'
              aria-label='加载中'
              className='grid grid-cols-4 gap-3 sm:grid-cols-5'
            >
              {Array.from({ length: skeletonCount }, (_, index) => (
                <div key={index} className='skeleton aspect-[2/3] rounded-lg' />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className='py-12 text-center text-sm text-gray-500'>
              {query.trim() ? '没有匹配的收藏' : '还没有收藏作品'}
            </p>
          ) : (
            <ul className='grid grid-cols-4 gap-3 sm:grid-cols-5'>
              {visible.map(({ key, favorite }) => {
                const order = selected.indexOf(key);
                const isSelected = order >= 0;
                const disabled = !isSelected && full;
                return (
                  <li key={key} className='min-w-0'>
                    <button
                      type='button'
                      aria-pressed={isSelected}
                      aria-label={favorite.title}
                      disabled={disabled || saving}
                      onClick={() => toggle(key)}
                      className='group block w-full text-left disabled:cursor-not-allowed'
                    >
                      <div
                        className={`relative aspect-[2/3] overflow-hidden rounded-lg bg-gray-100 ring-2 ring-offset-2 ring-offset-white transition dark:bg-gray-800 dark:ring-offset-gray-900 ${
                          isSelected
                            ? 'ring-brand-500'
                            : 'ring-transparent group-enabled:group-hover:ring-gray-300 dark:group-enabled:group-hover:ring-white/20'
                        } ${disabled ? 'opacity-40' : ''}`}
                      >
                        <CoverImage
                          src={favorite.cover}
                          alt={favorite.title}
                          sizes='120px'
                        />
                        {isSelected && (
                          <span className='absolute right-1 top-1 z-[101] flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[11px] font-semibold text-white shadow'>
                            {order + 1}
                          </span>
                        )}
                      </div>
                      <p className='mt-1 truncate text-xs text-gray-600 dark:text-gray-300'>
                        {favorite.title}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className='flex items-center justify-end gap-2 border-t border-gray-200/70 px-5 py-4 dark:border-white/[0.06]'>
          {error && (
            <p
              role='alert'
              className='mr-auto text-sm text-rose-600 dark:text-rose-400'
            >
              {error}
            </p>
          )}
          {selected.length > 0 && (
            <button
              type='button'
              disabled={saving}
              onClick={() => setSelected([])}
              className={`${MODAL_SECONDARY_BUTTON_CLASS} ${error ? '' : 'mr-auto'}`}
            >
              清空
            </button>
          )}
          <button
            type='button'
            disabled={!changed || saving}
            onClick={() => void save()}
            className={MODAL_PRIMARY_BUTTON_CLASS}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
