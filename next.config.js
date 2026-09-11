const { resolveAppVersion } = require('./src/lib/build-version');
const packageJson = require('./package.json');

const appVersion = resolveAppVersion({
  rootDir: __dirname,
  packageVersion: packageJson.version,
});

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn'] }
        : false,
  },
  serverExternalPackages: ['better-sqlite3', 'mysql2'],
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },

  images: {
    unoptimized: false,
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 7 * 24 * 60 * 60,
    qualities: [60, 72, 75],
    deviceSizes: [640, 750, 828, 1080],
    imageSizes: [48, 64, 96, 128, 180, 256, 320, 384],
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
  globPublicPatterns: [
    'changelog.json',
    'favicon.ico',
    'logo.webp',
    'manifest.json',
  ],
  exclude: [/static\/chunks\//, /static\/media\//],
})(nextConfig);
