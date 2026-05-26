/** @type {import('next').NextConfig} */
const path = require('path');

const { extractLatestVersion } = require('./src/lib/changelog-utils');
const packageJson = require('./package.json');

let appVersion = packageJson.version || '0.0.0';

try {
  const fs = require('fs');
  const changelogPaths = [
    path.join(__dirname, 'CHANGELOG'),
    path.join(__dirname, 'CHANGELOG.md'),
  ];

  for (const changelogPath of changelogPaths) {
    if (!fs.existsSync(changelogPath)) {
      continue;
    }

    const content = fs.readFileSync(changelogPath, 'utf8');
    const latestVersion = extractLatestVersion(content);
    if (latestVersion) {
      appVersion = latestVersion;
      break;
    }
  }
} catch {
  // Ignore and keep fallback version.
}

const nextConfig = {
  output: 'standalone',
  reactStrictMode: false,
  // dev server 允许的访问来源，避免 Next.js 未来版本在跨源访问 /_next/* 时拦截 HMR/静态资源
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn'] }
        : false,
  },
  serverExternalPackages: ['better-sqlite3', 'mysql2'],
  // 客户端 Router Cache：页面段在内存中保留 5 分钟，
  // 与首页 ISR revalidate=300 对齐，首页 → 搜索页 → 首页可复用组件树，
  // 避免 HomeClient 重挂载导致的状态、滚动位置丢失。
  experimental: {
    staleTimes: {
      dynamic: 300,
      static: 300,
    },
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },

  // Uncoment to add domain whitelist
  images: {
    unoptimized: false,
    // 优先输出 AVIF/WebP，节省带宽；现代浏览器自动协商
    formats: ['image/avif', 'image/webp'],
    // 服务端最小缓存 TTL：封面内容变化极少，延长到 7 天降低重复优化开销
    minimumCacheTTL: 7 * 24 * 60 * 60,
    deviceSizes: [640, 750, 828, 1080],
    imageSizes: [96, 128, 180, 256],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },

  webpack(config) {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) =>
      rule.test?.test?.('.svg'),
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: { not: /\.(css|scss|sass)$/ },
        resourceQuery: { not: /url/ }, // exclude if *.svg?url
        loader: '@svgr/webpack',
        options: {
          dimensions: false,
          titleProp: true,
        },
      },
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    return config;
  },
};

const withSerwist = require('@serwist/next').default;

module.exports = withSerwist({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
})(nextConfig);
