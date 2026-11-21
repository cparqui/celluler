module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/test'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1.js',
        // Offline guard: every DHT node must use a loopback test bootstrap.
        '^hyperdht$': '<rootDir>/test/helpers/guarded-hyperdht.cjs'
    },
    testTimeout: 30000,
    forceExit: true,
    detectOpenHandles: true,
    collectCoverage: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    transformIgnorePatterns: [
        'node_modules/(?!(moleculer|b4a|corestore|hypercore|hyperswarm)/)'
    ]
}; 