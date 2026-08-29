import '@testing-library/jest-dom';

// 未显式建库的测试不得写到开发库
process.env.LOCAL_DB_PATH = ':memory:';

// Allow router mocks.
jest.mock('next/router', () => require('next-router-mock'));
