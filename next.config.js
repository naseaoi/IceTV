const path = require('path');

const { extractLatestVersion } = require('./src/lib/changelog-utils');
const packageJson = require('./package.json');

let appVersion = packageJson.version || '0.0.0';

try {
  const fs = require('fs');
  const changelogPath = path.join(__dirname, 'CHANGELOG.md');

  if (fs.existsSync(changelogPath)) {
    const content = fs.readFileSync(changelogPath, 'utf8');
    const latestVersion = extractLatestVersion(content);
    if (latestVersion) {
      appVersion = latestVersion;
    }
  }
} catch {}

const nextConfig = {
  output: 'standalone',
  reactStrictMode: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn'] }
        : false,
  },
  serverExternalPackages: ['better-sqlite3', 'mysql2'],
  experimental: {
    staleTimes: {
      dynamic: 300,
      static: 300,
    },
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },

  images: {
    unoptimized: false,
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 7 * 24 * 60 * 60,
    qualities: [72, 75],
    deviceSizes: [640, 750, 828, 1080],
    imageSizes: [96, 128, 180, 256],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.doubanio.cmliussss.net',
      },
      {
        protocol: 'https',
        hostname: 'img.doubanio.cmliussss.com',
      },
      {
        protocol: 'https',
        hostname: 'lain.bgm.tv',
      },
    ],
  },

  webpack(config) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      net: false,
      tls: false,
      crypto: false,
    };

    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
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
