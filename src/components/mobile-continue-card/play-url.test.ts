import { buildMobileContinuePlayUrl } from '@/components/mobile-continue-card/play-url';

describe('buildMobileContinuePlayUrl', () => {
  it('编码播放参数中的特殊字符', () => {
    const url = buildMobileContinuePlayUrl({
      source: '源&一',
      id: 'video?id=1',
      title: '测试 标题',
      year: ' 2026 ',
      query: ' 原始&关键词 ',
    });
    const params = new URL(url, 'https://example.com').searchParams;

    expect(params.get('source')).toBe('源&一');
    expect(params.get('id')).toBe('video?id=1');
    expect(params.get('title')).toBe('测试 标题');
    expect(params.get('year')).toBe('2026');
    expect(params.get('stitle')).toBe('原始&关键词');
  });

  it('省略空白可选参数', () => {
    const url = buildMobileContinuePlayUrl({
      source: 'source',
      id: 'id',
      title: 'title',
      year: ' ',
      query: '',
    });
    const params = new URL(url, 'https://example.com').searchParams;

    expect(params.has('year')).toBe(false);
    expect(params.has('stitle')).toBe(false);
  });
});
