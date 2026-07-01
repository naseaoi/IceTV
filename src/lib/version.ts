import { changelogData } from '@/lib/changelog';

const CURRENT_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() ||
  changelogData.latestVersion ||
  '0.0.0';
const CURRENT_UPDATE_BRANCH =
  process.env.NEXT_PUBLIC_UPDATE_BRANCH?.trim() ||
  (/^\d+\.\d+\.\d+-dev\.\d+$/.test(CURRENT_VERSION) ? 'dev' : 'main');

export { CURRENT_UPDATE_BRANCH, CURRENT_VERSION };
