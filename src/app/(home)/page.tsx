import HomeClient from '@/features/home/components/HomeClient';
import { getHomeInitialData } from '@/lib/home.server';

/** 首页推荐数据 6 小时 ISR 缓存：豆瓣热门榜按日更新，短 TTL 无收益 */
export const revalidate = 21600;

export default async function Home() {
  const initialData = await getHomeInitialData();

  return <HomeClient initialData={initialData} />;
}
