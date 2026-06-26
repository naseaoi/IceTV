export interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: {
    id: number;
    name: string;
    name_cn: string;
    rating: {
      score: number;
    };
    air_date: string;
    images: {
      large: string;
      common: string;
      medium: string;
      small: string;
      grid: string;
    };
  }[];
}

type BangumiFetchInit = RequestInit & {
  next?: {
    revalidate?: number;
  };
};

export async function getBangumiCalendarData(
  init: BangumiFetchInit = {},
): Promise<BangumiCalendarData[]> {
  const response = await fetch('https://api.bgm.tv/calendar', init);

  if (!response.ok) {
    throw new Error(`获取 Bangumi 日历失败: ${response.status}`);
  }

  const data = (await response.json()) as BangumiCalendarData[];

  return data.map((item) => ({
    ...item,
    items: item.items.filter((bangumiItem) => bangumiItem.images),
  }));
}
