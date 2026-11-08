import { BangumiCalendarData } from '@/features/bangumi/lib/bangumi';
import { DoubanItem } from '@/lib/types';

import type { HomeHeroItem } from './home-hero';

export interface HomeInitialData {
  hotMovies: DoubanItem[];
  hotTvShows: DoubanItem[];
  hotVarietyShows: DoubanItem[];
  bangumiCalendarData: BangumiCalendarData[];
  // 服务端带简介挑选；为空时客户端按热门列表现挑
  heroItems: HomeHeroItem[];
}
