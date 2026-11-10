'use client';

import { Inbox } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSite } from '@/components/SiteProvider';
import Spinner from '@/components/Spinner';
import type { AnnouncementUserMessage } from '@/lib/message-types';
import { getAnnouncementHistoryPage } from '@/lib/messages.client';
import { formatRelativeTime } from '@/lib/relative-time';

const SECTION_TITLE_CLASS =
  'pb-2 text-xs font-semibold text-gray-500 dark:text-gray-400';
const CONTENT_CLASS =
  'whitespace-pre-line break-words text-sm leading-6 text-gray-800 dark:text-gray-100';

export default function MessageAnnouncements() {
  const { announcement: siteNotice } = useSite();
  const [items, setItems] = useState<AnnouncementUserMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async (cursor: string | null) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setFailed(false);
    try {
      const page = await getAnnouncementHistoryPage(cursor);
      if (requestId !== requestRef.current) return;
      setItems((previous) =>
        cursor ? [...previous, ...page.items] : page.items,
      );
      setNextCursor(page.nextCursor);
    } catch (error) {
      console.error('加载公告失败:', error);
      if (requestId === requestRef.current) setFailed(true);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const notice = siteNotice?.trim();
  const firstLoad = loading && items.length === 0;

  if (firstLoad && !notice)
    return (
      <div className='flex min-h-full items-center justify-center text-gray-400'>
        <Spinner className='h-6 w-6' />
      </div>
    );

  if (!loading && !failed && items.length === 0 && !notice)
    return (
      <div className='flex min-h-full flex-col items-center justify-center gap-2 px-4 text-center text-gray-400'>
        <Inbox className='h-10 w-10' />
        <p className='text-sm'>暂无公告</p>
      </div>
    );

  return (
    <div className='space-y-5'>
      {notice && (
        <section>
          <h3 className={SECTION_TITLE_CLASS}>站点须知</h3>
          <p
            className={`${CONTENT_CLASS} rounded-xl bg-gray-50 px-3 py-3 dark:bg-white/[0.04]`}
          >
            {notice}
          </p>
        </section>
      )}
      {(items.length > 0 || firstLoad || failed) && (
        <section>
          <h3 className={SECTION_TITLE_CLASS}>历史公告</h3>
          <ul className='divide-y divide-gray-100 dark:divide-white/[0.06]'>
            {items.map((item) => (
              <li key={item.id} className='py-3 first:pt-1'>
                <p className={CONTENT_CLASS}>{item.content}</p>
                <p className='mt-1 text-xs text-gray-400 dark:text-gray-500'>
                  <time dateTime={new Date(item.createdAt).toISOString()}>
                    {formatRelativeTime(item.createdAt)}
                  </time>
                </p>
              </li>
            ))}
          </ul>
          {loading ? (
            <div className='flex justify-center py-3 text-gray-400'>
              <Spinner className='h-4 w-4' />
            </div>
          ) : failed || nextCursor ? (
            <div className='flex justify-center pt-2'>
              <button
                type='button'
                className='inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700 dark:text-brand-400 dark:hover:bg-brand-950/50'
                onClick={() => void load(failed ? null : nextCursor)}
              >
                {failed ? '重新加载' : '加载更多'}
              </button>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
