'use client';

import { Cat, Clover, Film, Radio, Star, Tv } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import PageLayout from '@/components/PageLayout';
import { useRuntimeConfig } from '@/components/RuntimeConfigProvider';
import { withReturnTo } from '@/lib/navigation-return';
import { getCustomCategoryLabel } from '@/lib/runtime-config';

type ChannelEntry = {
  icon: typeof Film;
  iconClassName: string;
  label: string;
  description: string;
  href: string;
  prefetch?: boolean;
};

export default function CategoriesPageClient() {
  const runtimeConfig = useRuntimeConfig();

  const channels = useMemo<ChannelEntry[]>(() => {
    const entries: ChannelEntry[] = [
      {
        icon: Film,
        iconClassName: 'text-blue-500',
        label: '电影',
        description: '热门与分类电影',
        href: '/douban?type=movie',
      },
      {
        icon: Tv,
        iconClassName: 'text-emerald-500',
        label: '剧集',
        description: '热门剧集与榜单',
        href: '/douban?type=tv',
      },
      {
        icon: Cat,
        iconClassName: 'text-pink-500',
        label: '动漫',
        description: '新番放送与番剧',
        href: '/douban?type=anime',
      },
      {
        icon: Clover,
        iconClassName: 'text-violet-500',
        label: '综艺',
        description: '热门综艺节目',
        href: '/douban?type=show',
      },
    ];

    if (runtimeConfig?.ENABLE_LIVE_ENTRY) {
      entries.push({
        icon: Radio,
        iconClassName: 'text-red-500',
        label: '直播',
        description: '电视频道直播',
        href: withReturnTo('/live', '/categories'),
        prefetch: false,
      });
    }

    if ((runtimeConfig?.CUSTOM_CATEGORIES?.length ?? 0) > 0) {
      entries.push({
        icon: Star,
        iconClassName: 'text-amber-500',
        label: getCustomCategoryLabel(runtimeConfig),
        description: '站点自定义分类',
        href: '/douban?type=custom',
      });
    }

    return entries;
  }, [runtimeConfig]);

  return (
    <PageLayout activePath='/categories'>
      <div className='px-4 pb-4 pt-4 sm:px-10 sm:pt-8'>
        <div className='mx-auto max-w-[95%]'>
          <h1 className='mb-4 hidden text-xl font-bold text-gray-900 dark:text-gray-100 sm:block sm:text-2xl'>
            分类
          </h1>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
            {channels.map((channel) => (
              <Link
                key={channel.href}
                href={channel.href}
                prefetch={channel.prefetch}
                className='flex min-h-[72px] items-center gap-3 rounded-xl border border-gray-200/60 bg-white px-4 py-3 transition-colors hover:bg-gray-50 dark:border-gray-700/60 dark:bg-gray-800/60 dark:hover:bg-gray-800'
              >
                <channel.icon
                  className={`h-6 w-6 shrink-0 ${channel.iconClassName}`}
                />
                <span className='min-w-0'>
                  <span className='block text-sm font-semibold text-gray-900 dark:text-gray-100'>
                    {channel.label}
                  </span>
                  <span className='block truncate text-xs text-gray-500 dark:text-gray-400'>
                    {channel.description}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
