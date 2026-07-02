import { BangumiCalendarData } from '@/features/bangumi/lib/bangumi';
import { DoubanItem } from '@/lib/types';

export interface HomeInitialData {
  hotMovies: DoubanItem[];
  hotTvShows: DoubanItem[];
  hotVarietyShows: DoubanItem[];
  bangumiCalendarData: BangumiCalendarData[];
}
