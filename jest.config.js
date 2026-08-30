const nextJest = require('next/jest');

const createJestConfig = nextJest({
  dir: './',
});

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  moduleDirectories: ['node_modules', '<rootDir>/'],

  // 16 核上默认 15 worker 过订阅，反而更慢且触发 worker 强制退出警告
  maxWorkers: '50%',

  testEnvironment: 'jsdom',

  modulePathIgnorePatterns: ['<rootDir>/.next'],

  testPathIgnorePatterns: ['<rootDir>/node_modules/', '__fixtures__/'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^~/(.*)$': '<rootDir>/public/$1',
  },
};

module.exports = createJestConfig(customJestConfig);
