import type { PlayRecord } from '@/lib/types';

export const giriTrackingRecord: PlayRecord = {
  title: '碧蓝之海 第三季',
  source_name: 'Giri资源',
  cover: '',
  year: '2026',
  index: 16,
  total_episodes: 16,
  group_label: '简中 8',
  group_index: 8,
  group_total: 8,
  update_baseline_group_total: 8,
  update_baseline_episodes: 16,
  play_time: 600,
  total_time: 1440,
  save_time: 1000,
};

export function createGiriTrackingHtml(
  traditionalCount: number,
  simplifiedCount: number,
): string {
  const groups = [
    { label: '繁中', count: traditionalCount, groupId: 1 },
    { label: '简中', count: simplifiedCount, groupId: 2 },
  ];
  return `
    <h3 class="slide-info-title">碧蓝之海 第三季</h3>
    <div class="anthology-tab nav-swiper b-b"><div class="swiper-wrapper">
      ${groups.map((group) => `<a class="swiper-slide"><i class="fa ds-dianying"></i>&nbsp;${group.label}<span class="badge">${group.count}</span></a>`).join('')}
    </div></div>
    <div class="anthology-list top20 select-a">
      ${groups.map((group) => `<div class="anthology-list-box none"><ul class="anthology-list-play size">${Array.from({ length: group.count }, (_, index) => `<li><a href="/playGV27100-${group.groupId}-${index + 1}/">${String(index + 1).padStart(2, '0')}</a></li>`).join('')}</ul></div>`).join('')}
    </div>
  `;
}
