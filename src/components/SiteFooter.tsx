'use client';

import { Github, Heart } from 'lucide-react';
import { useState } from 'react';

import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import { SiteIcon } from '@/components/SiteIcon';
import { useSite } from '@/components/SiteProvider';
import { VersionPanel } from '@/components/user-menu/lazy-panels';
import { DEFAULT_SITE_FOOTER_TEXT } from '@/lib/site-footer';
import { getPrimaryRepoUrl } from '@/lib/update-source';
import { CURRENT_VERSION } from '@/lib/version';

const AUTHOR_NAME = 'naseaoi';
const AUTHOR_URL = 'https://github.com/naseaoi';
const FIRST_YEAR = 2025;

const DATA_SOURCES = [
  { label: '豆瓣', url: 'https://movie.douban.com/' },
  { label: 'Bangumi', url: 'https://bgm.tv/' },
];

const FOOTER_LINK_CLASS =
  'transition-colors hover:text-gray-900 dark:hover:text-gray-200';

export function SiteFooter() {
  const { siteName, footerText } = useSite();
  const text = footerText || DEFAULT_SITE_FOOTER_TEXT;
  const repoUrl = getPrimaryRepoUrl();
  const [versionOpen, setVersionOpen] = useState(false);
  const currentYear = new Date().getFullYear();
  const years =
    currentYear > FIRST_YEAR ? `${FIRST_YEAR}–${currentYear}` : FIRST_YEAR;

  return (
    <footer className='mt-8 border-t border-gray-200/70 dark:border-white/[0.06] sm:mt-12'>
      <div className={`${PAGE_CONTAINER_CLASS} py-6 sm:pb-14 sm:pt-8`}>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='flex items-center gap-3'>
            <span className='h-8 w-8 shrink-0'>
              <SiteIcon />
            </span>
            <div className='min-w-0'>
              <p className='flex items-baseline gap-2'>
                <span className='text-sm font-semibold text-gray-900 dark:text-white'>
                  {siteName}
                </span>
                <button
                  type='button'
                  onClick={() => setVersionOpen(true)}
                  className={`font-mono text-xs text-gray-400 dark:text-gray-500 ${FOOTER_LINK_CLASS}`}
                >
                  v{CURRENT_VERSION}
                </button>
              </p>
              <p className='mt-0.5 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400'>
                Made with
                <Heart
                  aria-hidden='true'
                  className='h-3 w-3 fill-red-400 text-red-400'
                />
                <span className='sr-only'>love</span>
                by
                <a
                  href={AUTHOR_URL}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={`font-medium text-gray-700 dark:text-gray-300 ${FOOTER_LINK_CLASS}`}
                >
                  {AUTHOR_NAME}
                </a>
                <span aria-hidden='true'>·</span>
                <span className='tabular-nums'>{years}</span>
              </p>
            </div>
          </div>

          <div className='flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 sm:gap-4'>
            <p className='flex items-center gap-1.5'>
              数据来自
              {DATA_SOURCES.map((source, index) => (
                <span key={source.label} className='flex items-center gap-1.5'>
                  {index > 0 && <span aria-hidden='true'>·</span>}
                  <a
                    href={source.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className={FOOTER_LINK_CLASS}
                  >
                    {source.label}
                  </a>
                </span>
              ))}
            </p>
            <a
              href={repoUrl}
              target='_blank'
              rel='noopener noreferrer'
              aria-label='GitHub'
              className='flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-900/[0.06] hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-white'
            >
              <Github className='h-[18px] w-[18px]' />
            </a>
          </div>
        </div>

        <p className='mt-5 whitespace-pre-line text-[11px] leading-5 text-gray-400 dark:text-gray-500'>
          {text}
        </p>
      </div>

      {versionOpen && (
        <VersionPanel isOpen onClose={() => setVersionOpen(false)} />
      )}
    </footer>
  );
}
