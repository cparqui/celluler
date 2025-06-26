// Test setup file for Jest
// This file runs before each test file

// Increase timeout for integration tests
jest.setTimeout(30000);

// Global test utilities
global.testUtils = {
    // Helper to create test UUIDs
    createTestUUID: (prefix = 'test') => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    
    // Helper to wait for async operations
    wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    
    // Helper to create test public keys
    createTestPublicKey: () => `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1vx7agoebGcQSuuPiLJX
ZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tS
oc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt
7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0
zgdLR_o1hiabtAjOcvjsyb3JnYXLovpDgjH16CjCDY1dQkrhwIGg8LCWfLUYmRKV
MjjNmUBG8xh3CtbKWPyCwfJgNI_R7O6pXLJgPnMc8uxJRaBFOGjw8q_SZfCKS1fH
-----END PUBLIC KEY-----`,
    
    // Helper to create test data directories
    createTestDataDir: (name) => {
        const path = require('path');
        const fs = require('fs');
        const testDir = path.join(process.cwd(), 'tmp', 'test', name);
        
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        
        return testDir;
    },
    
    // Helper to clean up test data
    cleanupTestData: async (name) => {
        const path = require('path');
        const fs = require('fs').promises;
        const testDir = path.join(process.cwd(), 'tmp', 'test', name);
        
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (err) {
            // Ignore errors if directory doesn't exist
        }
    }
};

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };
beforeAll(() => {
    console.log = jest.fn();
    console.debug = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
});

afterAll(() => {
    console.log = originalConsole.log;
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
});

// Global test environment setup
beforeEach(() => {
    // Reset any global state between tests
    jest.clearAllMocks();
});

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
}); 