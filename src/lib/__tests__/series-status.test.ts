import { type SeriesStatusInput, parseSeriesStatus } from '../series-status';

const cases: Array<
  [string, SeriesStatusInput, 'ongoing' | 'ended' | undefined]
> = [
  [
    '完结优先于连载与标记',
    { vod_remarks: '更新至24集 全24集', vod_isend: 0 },
    'ended',
  ],
  ['已完', { vod_remarks: '已完' }, 'ended'],
  ['完结', { vod_remarks: '完结' }, 'ended'],
  ['全集', { vod_remarks: '全集' }, 'ended'],
  ['全话', { vod_remarks: '全 12 話' }, 'ended'],
  ['全期', { vod_remarks: '全10期' }, 'ended'],
  [
    '连载优先于 isend 和总集数',
    {
      vod_remarks: '更新至12集',
      vod_isend: '1',
      vod_serial: 12,
      vod_total: 12,
    },
    'ongoing',
  ],
  ['更至', { vod_remarks: '更至10话' }, 'ongoing'],
  ['更新到', { vod_remarks: '更新到10集' }, 'ongoing'],
  ['连载', { vod_remarks: '连载中' }, 'ongoing'],
  [
    '单集连载优先于电影线索',
    { vod_remarks: '第 1 集 HD', type_name: '电影', episodeCount: 1 },
    'ongoing',
  ],
  ['数字完结标记', { vod_isend: 1 }, 'ended'],
  ['字符串完结标记', { vod_isend: '1' }, 'ended'],
  ['零不是连载证据', { vod_isend: 0 }, undefined],
  ['字符串零不是连载证据', { vod_isend: '0' }, undefined],
  ['布尔不是完结标记', { vod_isend: true }, undefined],
  ['数值总集数相等', { vod_serial: '12', vod_total: '12' }, 'ended'],
  ['数值总集数超过', { vod_serial: 13, vod_total: 12 }, 'ended'],
  ['未达总集数不作推断', { vod_serial: 11, vod_total: 12 }, undefined],
  ['零总集数不作推断', { vod_serial: 0, vod_total: 0 }, undefined],
  ['非数值集数', { vod_serial: '12集', vod_total: 12 }, undefined],
  ['无穷值', { vod_serial: Infinity, vod_total: 12 }, undefined],
  ['非数值总数', { vod_serial: 12, vod_total: true }, undefined],
  ['空总数', { vod_serial: 12, vod_total: ' ' }, undefined],
  ['单集电影', { type_name: '电影', episodeCount: 1 }, 'ended'],
  ['单集动作片', { type_name: '动作片', episodeCount: 1 }, 'ended'],
  ['单集高清', { vod_remarks: '1080p hd', episodeCount: 1 }, 'ended'],
  ['单集抢先', { vod_remarks: '抢先', episodeCount: 1 }, 'ended'],
  ['单集未知', { episodeCount: 1 }, undefined],
  ['单集电视剧', { type_name: '电视剧', episodeCount: 1 }, undefined],
  ['多集电影', { type_name: '电影', episodeCount: 2 }, undefined],
  ['多集高清', { vod_remarks: 'HD', episodeCount: 2 }, undefined],
  ['无集数电影', { type_name: '电影' }, undefined],
  ['缺省', {}, undefined],
  ['异常外部字段', { vod_remarks: 123, type_name: {} }, undefined],
];

it.each(cases)('%s', (_label, input, expected) => {
  expect(parseSeriesStatus(input)).toBe(expected);
});

it.each(['BD', '蓝光', '正片', '高清', 'TC', 'TS'])(
  '识别单集电影画质 %s',
  (vod_remarks) => {
    expect(parseSeriesStatus({ vod_remarks, episodeCount: 1 })).toBe('ended');
  },
);
