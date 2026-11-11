import {
  readDetailSnapshot,
  saveDetailSnapshot,
} from '@/features/play/lib/detailSnapshot';
import type { SearchResult } from '@/lib/types';

function createDetail(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'v1',
    title: '测试番剧',
    poster: 'https://cdn.example/poster.jpg',
    episodes: ['icetv-lazy://giri/playGV100-1-1/'],
    episodes_titles: ['第1集'],
    source: 'giri',
    source_name: 'Giri',
    class: '',
    year: '2026',
    desc: '',
    type_name: '动漫',
    douban_id: 0,
    ...overrides,
  };
}

describe('detailSnapshot', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('保存后可读取', () => {
    const detail = createDetail();
    saveDetailSnapshot('giri', 'v1', detail);

    expect(readDetailSnapshot('giri', 'v1')).toEqual(detail);
  });

  it('未命中返回 null', () => {
    expect(readDetailSnapshot('giri', 'missing')).toBeNull();
  });

  it('episodes 为空不写快照', () => {
    saveDetailSnapshot('giri', 'v1', createDetail({ episodes: [] }));

    expect(readDetailSnapshot('giri', 'v1')).toBeNull();
  });

  it('超过 TTL 的快照读取时清除', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem(
      'icetv-detail-snapshot:giri:v1',
      JSON.stringify({ data: createDetail(), savedAt: eightDaysAgo }),
    );

    expect(readDetailSnapshot('giri', 'v1')).toBeNull();
    expect(
      window.localStorage.getItem('icetv-detail-snapshot:giri:v1'),
    ).toBeNull();
  });

  it('损坏的快照读取时清除', () => {
    window.localStorage.setItem('icetv-detail-snapshot:giri:v1', '{bad json');

    expect(readDetailSnapshot('giri', 'v1')).toBeNull();
    expect(
      window.localStorage.getItem('icetv-detail-snapshot:giri:v1'),
    ).toBeNull();
  });

  it('超出容量上限按 savedAt 淘汰最旧', () => {
    const base = Date.now();
    const nowSpy = jest.spyOn(Date, 'now');
    for (let i = 0; i < 31; i++) {
      nowSpy.mockReturnValue(base + i * 1000);
      saveDetailSnapshot('giri', `v${i}`, createDetail({ id: `v${i}` }));
    }
    nowSpy.mockRestore();

    expect(readDetailSnapshot('giri', 'v0')).toBeNull();
    expect(readDetailSnapshot('giri', 'v1')).not.toBeNull();
    expect(readDetailSnapshot('giri', 'v30')).not.toBeNull();
  });
});

test('容量内保存只枚举键，不解析已有快照', () => {
  window.localStorage.clear();
  saveDetailSnapshot('giri', 'existing', createDetail());
  const parse = jest.spyOn(JSON, 'parse');
  try {
    saveDetailSnapshot('giri', 'new', createDetail());
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});

test('配额写入失败时减半清理并重试', () => {
  window.localStorage.clear();
  for (let i = 0; i < 30; i++)
    saveDetailSnapshot('giri', String(i), createDetail());
  const setItem = jest.spyOn(Storage.prototype, 'setItem');
  setItem.mockImplementationOnce(() => {
    throw new Error('quota');
  });
  try {
    saveDetailSnapshot('giri', 'retry', createDetail());
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(window.localStorage.length).toBe(16);
    expect(readDetailSnapshot('giri', 'retry')).not.toBeNull();
  } finally {
    setItem.mockRestore();
  }
});
