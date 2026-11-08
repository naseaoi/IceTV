import {
  CONTINUE_CARD_BODY_CLASS,
  CONTINUE_CARD_CLASS,
  CONTINUE_CARD_COVER_CLASS,
  CONTINUE_CARD_FOOTER_CLASS,
  CONTINUE_CARD_META_CLASS,
  CONTINUE_CARD_PROGRESS_BAR_CLASS,
  CONTINUE_CARD_PROGRESS_TEXT_CLASS,
  CONTINUE_CARD_TITLE_TEXT_CLASS,
} from '@/components/continue-card/layout';
import SkeletonText from '@/components/SkeletonText';

export default function ContinueWatchingCardSkeleton() {
  return (
    <div
      aria-hidden='true'
      data-continue-skeleton
      className={CONTINUE_CARD_CLASS}
    >
      <div className={`skeleton ${CONTINUE_CARD_COVER_CLASS}`} />
      <div className={CONTINUE_CARD_BODY_CLASS}>
        <SkeletonText className={CONTINUE_CARD_TITLE_TEXT_CLASS} />
        <div className={CONTINUE_CARD_META_CLASS}>
          <SkeletonText barClassName='h-3 w-1/2 rounded' />
          <SkeletonText barClassName='h-3 w-1/3 rounded' />
        </div>
        <div className={CONTINUE_CARD_FOOTER_CLASS}>
          <div
            className={`${CONTINUE_CARD_PROGRESS_TEXT_CLASS} flex items-center justify-between`}
          >
            <SkeletonText
              className='flex-1'
              barClassName='h-2.5 w-1/2 rounded'
            />
            <div className='skeleton h-2.5 w-6 rounded' />
          </div>
          <div className={`skeleton ${CONTINUE_CARD_PROGRESS_BAR_CLASS}`} />
        </div>
      </div>
    </div>
  );
}
