import type { Config } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

// 全站唯一强调色（冰蓝），只用于选中态、进度和主操作
const brand = {
  50: '#f0f7fc',
  100: '#dcedf8',
  200: '#bddcf1',
  300: '#8fc4e6',
  400: '#5fa8d8',
  500: '#3d8dc6',
  600: '#2d73a9',
  700: '#265d89',
  800: '#234f72',
  900: '#21435f',
  950: '#152b3f',
};

// 冷调中性灰，覆盖默认 gray，深色模式各层表面由它派生
const gray = {
  50: '#f6f7f9',
  100: '#eceef1',
  200: '#dadde3',
  300: '#babfc8',
  400: '#8c929c',
  500: '#6b717b',
  600: '#535861',
  700: '#3d4149',
  800: '#272a31',
  900: '#181a1f',
  950: '#0d0e11',
};

const config: Config = {
  darkMode: 'class',
  // 开发时改动扫描范围内的任何文件都会重跑一次样式构建，测试与接口路由不含样式类名
  content: [
    './src/{components,app,features}/**/*.{ts,tsx}',
    '!./src/app/api/**',
    '!./src/**/*.test.{ts,tsx}',
    '!./src/**/__tests__/**',
  ],
  theme: {
    screens: {
      xs: '480px',
      // 播放页左右分栏：竖屏平板宽度不足以并排播放器与面板，改为上下排列。
      // 排在默认断点前，使 xl: 等宽度断点能覆盖它
      split: {
        raw: '(min-width: 768px) and (orientation: landscape), (min-width: 1280px)',
      },
      // 含 raw 断点后 Tailwind 不再生成 max-* 变体，窄屏条件需单独声明
      'phone-landscape': {
        raw: '(max-width: 767px) and (orientation: landscape)',
      },
      ...defaultTheme.screens,
    },
    extend: {
      fontFamily: {
        primary: [
          'Inter',
          'system-ui',
          '-apple-system',
          'PingFang SC',
          'Microsoft YaHei',
          'Hiragino Sans GB',
          'Noto Sans SC',
          'sans-serif',
          ...defaultTheme.fontFamily.sans,
        ],
      },
      colors: {
        brand,
        gray,
        dark: '#222222',
      },
      keyframes: {
        flicker: {
          '0%, 19.999%, 22%, 62.999%, 64%, 64.999%, 70%, 100%': {
            opacity: '0.99',
            filter:
              'drop-shadow(0 0 1px rgba(252, 211, 77)) drop-shadow(0 0 15px rgba(245, 158, 11)) drop-shadow(0 0 1px rgba(252, 211, 77))',
          },
          '20%, 21.999%, 63%, 63.999%, 65%, 69.999%': {
            opacity: '0.4',
            filter: 'none',
          },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        statusIconIn: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        slideInFromRight: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        // --hero-dir 为 1 时新内容从右侧进入，-1 时从左侧进入
        heroSlideIn: {
          '0%': {
            transform: 'translateX(calc(var(--hero-dir, 1) * 32%))',
            opacity: '0',
          },
          '30%': { opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        heroSlideOut: {
          '0%': { transform: 'translateX(0)', opacity: '1' },
          '55%': { opacity: '0' },
          '100%': {
            transform: 'translateX(calc(var(--hero-dir, 1) * -32%))',
            opacity: '0',
          },
        },
      },
      animation: {
        flicker: 'flicker 3s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-in-out',
        'slide-down': 'slideDown 0.3s ease-in-out',
        'slide-in-from-right': 'slideInFromRight 0.3s ease-out',
        'overlay-in': 'fadeIn 0.2s ease-out',
        'status-icon-in':
          'statusIconIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'menu-in-down': 'slideDown 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        'hero-slide-in':
          'heroSlideIn 0.65s cubic-bezier(0.22, 1, 0.36, 1) both',
        'hero-slide-out':
          'heroSlideOut 0.65s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
} satisfies Config;

export default config;
