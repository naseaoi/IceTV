import eslintConfigNext from 'eslint-config-next';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';

// 项目约定的静默失效点，规则说明见 AGENTS.md 与 docs/frontend.md
const classRule = (pattern, message) => [
  { selector: `Literal[value=${pattern}]`, message },
  { selector: `TemplateElement[value.raw=${pattern}]`, message },
];

const NATIVE_SELECT_RULE = {
  selector: "JSXOpeningElement[name.name='select']",
  message: '下拉统一用 src/components/Select.tsx。',
};
const MAX_VARIANT_RULES = classRule(
  '/(^|[^a-z0-9-])max-(sm|md|lg|xl|2xl):/',
  'tailwind 配置含 raw 断点，max-* 变体不会生成；改写为基础类加 sm:/md: 覆盖。',
);
const LOADING_CLASS_RULES = classRule(
  '/(^|[^a-z0-9-])animate-(pulse|spin)([^a-z0-9-]|$)/',
  '骨架用 skeleton 类，转圈用 Spinner 组件。',
);
const BACKDROP_BLUR_RULES = classRule(
  '/(^|[^a-z0-9-])backdrop-blur/',
  '毛玻璃只用于吸顶导航与筛选栏，其他浮层与徽标用实底。',
);
const BASE_SYNTAX_RULES = [
  NATIVE_SELECT_RULE,
  ...MAX_VARIANT_RULES,
  ...LOADING_CLASS_RULES,
];

// 吸顶导航与筛选栏
const BACKDROP_BLUR_ALLOWED_FILES = [
  'src/components/TopNav.tsx',
  'src/components/MobileHeader.tsx',
  'src/components/MobileBottomNav.tsx',
  'src/components/mobile/MobileChannelHeader.tsx',
  'src/features/home/components/MeShell.tsx',
  'src/features/search/lib/search-layout.ts',
  'src/features/douban/components/DoubanFilterBar.tsx',
  'src/features/playback-stats/components/PlaybackHistoryLibrary.tsx',
];
const TEST_FILES = ['src/**/__tests__/**', 'src/**/*.test.{ts,tsx}'];

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  ...eslintConfigNext,
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'public/sw.js',
      'public/workbox-*.js',
    ],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}'],
    languageOptions: {
      globals: {
        React: true,
        JSX: true,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSortPlugin,
      'unused-imports': unusedImportsPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      'no-console': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'react/no-unescaped-entities': 'off',
      'react/display-name': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/unsupported-syntax': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/refs': 'off',
      'react/jsx-curly-brace-presence': 'off',
      '@next/next/no-img-element': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'simple-import-sort/exports': 'warn',
      'simple-import-sort/imports': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...BASE_SYNTAX_RULES,
        ...BACKDROP_BLUR_RULES,
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*'],
              message: '跨目录导入统一走 @/ 路径。',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: '经 src/lib/browser-storage.ts 或对应偏好 helper 读写。',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: '经 src/lib/browser-storage.ts 或对应偏好 helper 读写。',
        },
      ],
    },
  },
  {
    files: BACKDROP_BLUR_ALLOWED_FILES,
    rules: {
      'no-restricted-syntax': ['error', ...BASE_SYNTAX_RULES],
    },
  },
  {
    files: ['src/lib/browser-storage.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
];
