import '@testing-library/jest-dom';

// 未显式建库的测试不得写到开发库
process.env.LOCAL_DB_PATH = ':memory:';

// better-sqlite3 原生模块在 Jest 进程内只加载一次，错误构造器只在首个用到它的测试文件注册；
// 复位后由当前文件重新注册，否则之后文件里的 SqliteError 不是本文件 Error 的实例，rejects.toThrow 会判为未抛错
const betterSqliteRoot = require('path').dirname(
  require.resolve('better-sqlite3/package.json'),
);
require(require.resolve('bindings', { paths: [betterSqliteRoot] }))({
  bindings: 'better_sqlite3.node',
  module_root: betterSqliteRoot,
}).isInitialized = false;

// Allow router mocks.
jest.mock('next/router', () => require('next-router-mock'));

jest.mock('@/lib/upstream-resource-guard.server', () => ({
  withUpstreamTask: (_url, task, signal) =>
    task(signal || new AbortController().signal),
  withUpstreamResponse: (_url, loader, options = {}) =>
    loader(options.signal || new AbortController().signal),
}));

jest.mock('@/lib/upstream-fetch.server', () => ({
  fetchUpstream: (url, init) => fetch(url, init),
  fetchPrivateUpstream: (url, init) => fetch(url, init),
}));
