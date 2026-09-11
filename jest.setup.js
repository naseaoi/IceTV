import '@testing-library/jest-dom';

// 未显式建库的测试不得写到开发库
process.env.LOCAL_DB_PATH = ':memory:';

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
