import { changelogData } from '@/lib/changelog';

const CURRENT_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
  changelogData.latestVersion ||
  '0.0.0';

// 导出当前版本号供其他地方使用
export { CURRENT_VERSION };
