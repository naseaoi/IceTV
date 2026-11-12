import {
  readListCountCookie,
  writeListCountCookie,
} from '@/lib/list-count-cookies';

// 「我的」横幅与评价页共用的本人评价总数，任一处拿到后另一处的骨架即可按真实条数渲染
const knownCounts = new Map<string, number>();

export function getKnownMyReviewCount(profileId: string): number | null {
  return knownCounts.get(profileId) ?? readListCountCookie('review_count');
}

export function rememberMyReviewCount(profileId: string, count: number): void {
  knownCounts.set(profileId, count);
  writeListCountCookie('review_count', count);
}
