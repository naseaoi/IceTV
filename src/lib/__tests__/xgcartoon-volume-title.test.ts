import { extractXgcartoonEpisodeVariants } from '@/lib/xgcartoon';

describe('xgcartoon volume title variants', () => {
  it('保留源站的五个分组', () => {
    const html = `
      <div class="col-12 volume-title">第一季【全25話】</div>
      <a href="/user/page_direct?cartoon_id=test&chapter_id=s1e1" class="goto-chapter"><span>第1話</span></a>
      <div class="col-12 volume-title">第二季【上季】【全13話】</div>
      <a href="/user/page_direct?cartoon_id=test&chapter_id=s2a1" class="goto-chapter"><span>第1話</span></a>
      <div class="col-12 volume-title">第二季【下季】【全12話】</div>
      <a href="/user/page_direct?cartoon_id=test&chapter_id=s2b1" class="goto-chapter"><span>第1話</span></a>
      <div class="col-12 volume-title">第三季【全16話】</div>
      <a href="/user/page_direct?cartoon_id=test&chapter_id=s3e1" class="goto-chapter"><span>第1話</span></a>
      <div class="col-12 volume-title">第四季【更新至11話】</div>
      <a href="/user/page_direct?cartoon_id=test&chapter_id=s4e1" class="goto-chapter"><span>第1話</span></a>
    `;

    const variants = extractXgcartoonEpisodeVariants(html);

    expect(variants).toHaveLength(5);
    expect(variants.map((item) => item.groupId)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(variants.map((item) => item.label)).toEqual([
      '第一季【全25話】',
      '第二季【上季】【全13話】',
      '第二季【下季】【全12話】',
      '第三季【全16話】',
      '第四季【更新至11話】',
    ]);
  });
});
