import eslintConfigNext from 'eslint-config-next';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';
import unusedImportsPlugin from 'eslint-plugin-unused-imports';

export default [
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'warn',
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
      // TODO: 超大文件拆分后重新启用为 'warn'
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/refs': 'off',
      'react/jsx-curly-brace-presence': 'off',
      '@next/next/no-img-element': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'off',
      'unused-imports/no-unused-vars': 'off',
      'simple-import-sort/exports': 'off',
      'simple-import-sort/imports': 'off',
    },
  },
];
