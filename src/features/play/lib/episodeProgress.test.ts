import {
  buildEpisodeProgressKeys,
  getEpisodeProgressView,
  parseStrictEpisodeNumber,
  resolveEpisodeProgressResumeTime,
} from '@/features/play/lib/episodeProgress';
import type { SearchResult } from '@/lib/types';

function detail(
  source: string,
  titles: string[],
  episodeGroups?: SearchResult['episode_groups'],
): SearchResult {
  return {
    id: '1',
    source,
    source_name: source,
    title: '作品',
    poster: '',
    year: '2024',
    episodes: titles.map((_, index) => `https://example.com/${index}.m3u8`),
    episodes_titles: titles,
    episode_groups: episodeGroups,
  } as SearchResult;
}

describe('parseStrictEpisodeNumber', () => {
  it.each([
    ['第1集', '1'],
    ['第 01 话', '1'],
    ['07', '7'],
    ['EP12', '12'],
    ['12.5', '12.5'],
    ['第3集 上', '3'],
  ])('%s → %s', (title, expected) => {
    expect(parseStrictEpisodeNumber(title)).toBe(expected);
  });

  it.each([
    'SP1',
    'OVA',
    '特别篇',
    '总集篇 2',
    'HD1080P',
    '2024-01-05',
    '',
    undefined,
  ])('%s 不当集号', (title) => {
    expect(parseStrictEpisodeNumber(title)).toBeNull();
  });
});

describe('buildEpisodeProgressKeys', () => {
  it('集号唯一时用集号，多出的特别篇不影响其他集对应', () => {
    const a = buildEpisodeProgressKeys(
      detail('a', ['第1集', '第2集', '第3集']),
    );
    const b = buildEpisodeProgressKeys(detail('b', ['01', 'SP', '02', '03']));
    expect(a).toEqual(['n:1', 'n:2', 'n:3']);
    expect(b).toEqual(['n:1', 'i:b:2/4', 'n:2', 'n:3']);
    expect(b.indexOf(a[1])).toBe(2);
  });

  it('集号重复或解析不出时退回带源标识的序号，换源后对不上', () => {
    const keys = buildEpisodeProgressKeys(
      detail('a', ['第1集 上', '第1集 下', '正片']),
    );
    expect(keys).toEqual(['i:a:1/3', 'i:a:2/3', 'i:a:3/3']);
    const other = buildEpisodeProgressKeys(
      detail('b', ['第1集 上', '第1集 下', '正片']),
    );
    expect(other.some((key) => keys.includes(key))).toBe(false);
  });

  it('分组源按组内集号区分，组标签里随更新变化的集数不进身份', () => {
    const before = buildEpisodeProgressKeys(
      detail(
        'giri',
        ['01', '02', '01', '02'],
        [
          { label: '繁中 2', count: 2 },
          { label: '简中 2', count: 2 },
        ],
      ),
    );
    const after = buildEpisodeProgressKeys(
      detail(
        'giri',
        ['01', '02', '03', '01', '02'],
        [
          { label: '繁中 3', count: 3 },
          { label: '简中 2', count: 2 },
        ],
      ),
    );
    expect(before).toEqual([
      'g:繁中|n:1',
      'g:繁中|n:2',
      'g:简中|n:1',
      'g:简中|n:2',
    ]);
    expect(after.indexOf(before[3])).toBe(4);
  });

  it('单集作品不建表', () => {
    expect(buildEpisodeProgressKeys(detail('a', ['正片']))).toEqual([]);
  });
});

describe('每集续播点', () => {
  const entry = (t: number, d = 1000) => ({ k: 'n:1', t, d, at: 1 });

  it('看到一半从上次位置继续，播到结尾或没有记录从头播', () => {
    expect(resolveEpisodeProgressResumeTime(entry(303))).toBe(303);
    expect(resolveEpisodeProgressResumeTime(entry(996))).toBe(0);
    expect(resolveEpisodeProgressResumeTime(undefined)).toBe(0);
    expect(resolveEpisodeProgressResumeTime(entry(1))).toBe(0);
  });

  it('离结尾还有一段时不算看完', () => {
    expect(getEpisodeProgressView(entry(900))).toEqual({
      finished: false,
      ratio: 0.9,
    });
    expect(resolveEpisodeProgressResumeTime(entry(900))).toBe(900);
  });

  it('设了跳过片尾时到片尾点即算看完', () => {
    const skip = { enable: true, outro_time: -150 };
    expect(getEpisodeProgressView(entry(860), skip)).toEqual({
      finished: true,
      ratio: 1,
    });
    expect(resolveEpisodeProgressResumeTime(entry(860), skip)).toBe(0);
    expect(resolveEpisodeProgressResumeTime(entry(860))).toBe(860);
  });
});
