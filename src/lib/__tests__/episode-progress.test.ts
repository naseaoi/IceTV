import {
  isEpisodeProgressKey,
  MAX_EPISODE_PROGRESS_ENTRIES,
  MAX_EPISODE_PROGRESS_KEY_LENGTH,
  mergeEpisodeProgress,
} from '@/lib/episode-progress';

const episode = (k: string, at: number) => ({ k, t: 15, d: 100, at });

it.each([
  'n:1',
  'n:999999.125',
  'i:abc:1',
  'i:abc:1/12',
  'g:第 2 季|n:4',
  'g:特别篇|i:源站:2',
  'g:特别篇|i:源站:2/3',
])('接受合法集身份 %s', (key) => expect(isEpisodeProgressKey(key)).toBe(true));

it.each([
  null,
  12,
  '',
  'n:-1',
  'n:1234567',
  'n:1.1234',
  'n:1\n',
  'i::1/2',
  'i::1',
  'i:source:',
  'g:|n:1',
  'g:one|two|n:1',
  `g:${'x'.repeat(65)}|n:1`,
  `i:${'x'.repeat(MAX_EPISODE_PROGRESS_KEY_LENGTH)}:1/2`,
])('拒绝非法集身份 %s', (key) => {
  expect(isEpisodeProgressKey(key)).toBe(false);
});

it('同集取较新条目并按保存时间倒序', () => {
  const latest = { ...episode('n:1', 500), t: 39 };
  const second = episode('n:2', 300);
  expect(
    mergeEpisodeProgress([[episode('n:1', 100), second], [latest]]),
  ).toEqual([latest, second]);
});

it('只保留最近 50 集', () => {
  const entries = Array.from({ length: 60 }, (_, i) =>
    episode(`n:${i + 1}`, i + 1),
  );
  const merged = mergeEpisodeProgress([entries]);
  expect(merged).toHaveLength(MAX_EPISODE_PROGRESS_ENTRIES);
  expect(merged).toEqual(entries.slice(-50).reverse());
});

it('忽略非数组与畸形条目', () => {
  const valid = episode('n:1', 100);
  expect(
    mergeEpisodeProgress([
      { entry: valid },
      undefined,
      [
        null,
        'n:2',
        {},
        { ...valid, k: 'bad' },
        { ...valid, t: -1 },
        { ...valid, t: '15' },
        { ...valid, d: 0.5 },
        { ...valid, at: Infinity },
        { ...valid, at: Number.MAX_SAFE_INTEGER + 1 },
        valid,
      ],
    ]),
  ).toEqual([valid]);
});

it('按目标源只筛掉其他源的索引身份', () => {
  const numbered = episode('g:第二季|n:2', 400);
  const matchingIndex = episode('i:target:2', 350);
  const matchingGroupIndex = episode('g:第二季|i:target:2', 320);
  const otherIndex = episode('i:other:2', 300);
  const otherGroupIndex = episode('g:第二季|i:other:2', 200);
  const entries = [
    numbered,
    matchingIndex,
    matchingGroupIndex,
    otherIndex,
    otherGroupIndex,
  ];
  expect(mergeEpisodeProgress([entries])).toEqual(entries);
  expect(mergeEpisodeProgress([entries], { source: 'target' })).toEqual([
    numbered,
    matchingIndex,
    matchingGroupIndex,
  ]);
});

it('旧版带集数后缀的序号身份并入时去掉后缀，连载更新后仍对得上', () => {
  const legacy = episode('g:第二季|i:target:2/5', 300);
  const legacyOtherCount = episode('i:target:3/6', 200);
  const current = episode('g:第二季|i:target:2', 100);
  expect(
    mergeEpisodeProgress([[legacy, legacyOtherCount], [current]], {
      source: 'target',
    }),
  ).toEqual([
    { ...legacy, k: 'g:第二季|i:target:2' },
    { ...legacyOtherCount, k: 'i:target:3' },
  ]);
});
