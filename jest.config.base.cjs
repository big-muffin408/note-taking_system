// 所有 Node 服务共用的 Jest 基础配置（各服务 jest.config.js 直接 re-export）
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Jest（CJS 模式）无法加载 @notes/shared 的 ESM dist，直接映射到源码由 ts-jest 转译
    '^@notes/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@notes/shared/testing$': '<rootDir>/../../packages/shared/src/testing/index.ts',
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  setupFiles: ['<rootDir>/../../packages/shared/jest.setup.cjs'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
};
