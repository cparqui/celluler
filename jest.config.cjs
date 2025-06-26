module.exports = {
    testEnvironment: 'node',
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1.js'
    },
    testTimeout: 30000,
    forceExit: true,
    detectOpenHandles: true,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html', 'json'],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/test/',
        '/coverage/',
        '/tmp/',
        '/dist/'
    ],
    testMatch: [
        '<rootDir>/test/**/*.test.js',
        '<rootDir>/test/**/*.spec.js'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/tmp/'
    ],
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    transformIgnorePatterns: [
        'node_modules/(?!(moleculer|b4a|corestore|hypercore|hyperswarm)/)'
    ],
    setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
    verbose: true,
    maxWorkers: 1 // Run tests sequentially to avoid conflicts
}; 