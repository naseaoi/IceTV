export type VirtualizedGridLayoutConfig = {
  breakpoint?: number;
  posterAspectRatio?: number;
  mobileColumnCount?: number;
  mobileWideBreakpoint?: number;
  mobileWideColumnCount?: number;
  mobileColumnGap?: number;
  mobileRowGap?: number;
  mobileItemWidth?: number;
  mobileContentHeight?: number;
  desktopColumnGap?: number;
  desktopRowGap?: number;
  desktopMinColumnWidth?: number;
  desktopItemWidth?: number;
  desktopContentHeight?: number;
};

export type GridLayout = {
  columnCount: number;
  columnGap: number;
  rowGap: number;
  trackWidth: number;
  itemWidth: number;
  rowHeight: number;
};

const DEFAULT_LAYOUT: Required<VirtualizedGridLayoutConfig> = {
  breakpoint: 640,
  posterAspectRatio: 1.5,
  mobileColumnCount: 3,
  mobileWideBreakpoint: 480,
  mobileWideColumnCount: 0,
  mobileColumnGap: 8,
  mobileRowGap: 56,
  mobileItemWidth: 0,
  mobileContentHeight: 72,
  desktopColumnGap: 32,
  desktopRowGap: 80,
  desktopMinColumnWidth: 176,
  desktopItemWidth: 0,
  desktopContentHeight: 98,
};

export function getGridLayout(
  containerWidth: number,
  viewportWidth: number,
  config: VirtualizedGridLayoutConfig = {},
): GridLayout {
  const layout = { ...DEFAULT_LAYOUT, ...config };
  const isDesktop = viewportWidth >= layout.breakpoint;
  const columnGap = isDesktop
    ? layout.desktopColumnGap
    : layout.mobileColumnGap;
  const rowGap = isDesktop ? layout.desktopRowGap : layout.mobileRowGap;
  const fixedItemWidth = isDesktop
    ? layout.desktopItemWidth
    : layout.mobileItemWidth;
  const minColumnWidth = isDesktop
    ? layout.desktopMinColumnWidth
    : Math.max(1, fixedItemWidth || 1);
  const columnCount = isDesktop
    ? Math.max(
        1,
        Math.floor((containerWidth + columnGap) / (minColumnWidth + columnGap)),
      )
    : layout.mobileWideColumnCount > 0 &&
        viewportWidth >= layout.mobileWideBreakpoint
      ? layout.mobileWideColumnCount
      : layout.mobileColumnCount;
  const trackWidth =
    fixedItemWidth && isDesktop
      ? fixedItemWidth
      : (containerWidth - columnGap * (columnCount - 1)) / columnCount;
  const itemWidth = fixedItemWidth || trackWidth;
  const contentHeight = isDesktop
    ? layout.desktopContentHeight
    : layout.mobileContentHeight;
  const rowHeight =
    itemWidth * layout.posterAspectRatio + contentHeight + rowGap;

  return {
    columnCount,
    columnGap,
    rowGap,
    trackWidth,
    itemWidth,
    rowHeight,
  };
}
