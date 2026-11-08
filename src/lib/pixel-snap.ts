// 浮层在 transform 动画期间独立合成、按小数坐标绘制，动画结束后文字会吸附到像素网格而轻微跳动；
// 定位坐标先对齐到物理像素，动画前后的绘制位置就一致
export function snapToDevicePixel(value: number) {
  const ratio = window.devicePixelRatio || 1;
  return Math.round(value * ratio) / ratio;
}
