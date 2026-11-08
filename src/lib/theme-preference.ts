import { serializeForInlineScript } from '@/lib/script-serialization';

export const THEME_STORAGE_KEY = 'theme';
export const DEFAULT_THEME = 'dark';

// 在 head 内于首次绘制前应用已存主题，避免首屏闪烁。存储键、默认值与 ThemeProvider 共用本文件常量，
// 脚本运行在水合前无法使用 browser-storage，自行 try/catch 兜底
export function buildThemeInitScript(): string {
  return `(() => {
  try {
    const saved = localStorage.getItem(${serializeForInlineScript(THEME_STORAGE_KEY)});
    const theme = saved === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : saved === 'light' || saved === 'dark'
        ? saved
        : ${serializeForInlineScript(DEFAULT_THEME)};
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    root.style.colorScheme = theme;
  } catch {}
})();`;
}
