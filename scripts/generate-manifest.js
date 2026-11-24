#!/usr/bin/env node
// 根据 NEXT_PUBLIC_SITE_NAME 动态生成 manifest.json

const fs = require('fs');
const path = require('path');

// 获取项目根目录
const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const manifestPath = path.join(publicDir, 'manifest.json');

// 从环境变量获取站点名称
const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'IceTV';

// 与 src/lib/site-icon.ts 一致：图标地址带应用版本，换图后长缓存随发版失效
function resolveIconVersion() {
  const explicitVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (explicitVersion) return explicitVersion;

  // 运行时镜像只带 scripts/ 不带 src/，start.js 每次启动都会执行本脚本，版本只能取镜像 ENV；
  // 本地构建与开发没有注入版本，按 next.config.js 的同一规则解析
  const { resolveAppVersion } = require('../src/lib/build-version');
  return resolveAppVersion({
    rootDir: projectRoot,
    packageVersion: require('../package.json').version,
  });
}

const iconVersion = encodeURIComponent(resolveIconVersion());
const icon = (file) => `/icons/${file}?v=${iconVersion}`;

// manifest.json 模板
const manifestTemplate = {
  name: siteName,
  short_name: siteName,
  description: '影视聚合',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#000000',
  'apple-mobile-web-app-capable': 'yes',
  'apple-mobile-web-app-status-bar-style': 'black',
  icons: [
    {
      src: icon('icon-192x192.png'),
      sizes: '192x192',
      type: 'image/png',
    },
    {
      src: icon('icon-256x256.png'),
      sizes: '256x256',
      type: 'image/png',
    },
    {
      src: icon('icon-384x384.png'),
      sizes: '384x384',
      type: 'image/png',
    },
    {
      src: icon('icon-512x512.png'),
      sizes: '512x512',
      type: 'image/png',
    },
    // 安卓启动器按 maskable 图标裁切，图形须在中心 80% 的安全区内
    {
      src: icon('icon-maskable-192x192.png'),
      sizes: '192x192',
      type: 'image/png',
      purpose: 'maskable',
    },
    {
      src: icon('icon-maskable-512x512.png'),
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

try {
  // 确保 public 目录存在
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  // 写入 manifest.json
  fs.writeFileSync(manifestPath, JSON.stringify(manifestTemplate, null, 2));
  console.log(`✅ Generated manifest.json with site name: ${siteName}`);
} catch (error) {
  console.error('❌ Error generating manifest.json:', error);
  process.exit(1);
}
