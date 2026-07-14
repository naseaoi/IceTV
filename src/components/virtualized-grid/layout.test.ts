import { getGridLayout } from '@/components/virtualized-grid/layout';

const DOUBAN_LAYOUT = {
  mobileColumnCount: 3,
  mobileWideBreakpoint: 480,
  mobileWideColumnCount: 4,
  mobileColumnGap: 12,
  mobileRowGap: 24,
  mobileItemWidth: 0,
  mobileContentHeight: 28,
  desktopColumnGap: 28,
  desktopRowGap: 56,
  desktopMinColumnWidth: 180,
  desktopItemWidth: 180,
  desktopContentHeight: 28,
};

describe('getGridLayout', () => {
  it('保留移动端容器的子像素尺寸', () => {
    const layout = getGridLayout(340.475, 390, DOUBAN_LAYOUT);

    expect(layout.columnCount).toBe(3);
    expect(layout.itemWidth).toBeCloseTo(105.4917, 4);
    expect(layout.rowHeight).toBeCloseTo(210.2375, 4);
  });

  it('按视口宽度切换移动端宽屏列数', () => {
    const layout = getGridLayout(425.6, 480, DOUBAN_LAYOUT);

    expect(layout.columnCount).toBe(4);
    expect(layout.itemWidth).toBeCloseTo(97.4, 4);
  });

  it('按视口断点进入桌面网格', () => {
    const layout = getGridLayout(532, 640, DOUBAN_LAYOUT);

    expect(layout.columnCount).toBe(2);
    expect(layout.itemWidth).toBe(180);
    expect(layout.rowHeight).toBe(354);
  });
});
