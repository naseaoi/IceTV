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

export function createGiriTrackingResponse(
  traditionalCount: number,
  simplifiedCount: number,
) {
  return {
    code: 1,
    msg: '获取成功',
    info: {
      vod_id: 27100,
      vod_name: '碧蓝之海 第三季',
      vod_year: '2026',
      vod_play_from: 'cht$$$chs',
      vod_play_url: [traditionalCount, simplifiedCount]
        .map((count, groupIndex) =>
          Array.from(
            { length: count },
            (_, index) =>
              `${String(index + 1).padStart(2, '0')}$https://ana.girigirilove.com/${groupIndex + 1}/${index + 1}.mp4`,
          ).join('#'),
        )
        .join('$$$'),
    },
  };
}
