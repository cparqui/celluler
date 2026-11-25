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
    collectCoverage: true,
    // The CLI entry point and the generated encodings are excluded.
    collectCoverageFrom: ['src/**/*.js', '!src/cli.js', '!src/lib/nucleus/schema/**'],
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    transform: {
        '^.+\\.js$': 'babel-jest'
    },
    transformIgnorePatterns: [
        'node_modules/(?!(moleculer|b4a|corestore|hypercore|hyperswarm)/)'
    ]
};
