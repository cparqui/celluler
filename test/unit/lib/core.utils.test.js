import { getCoreInfo, generateCellUUID, generateKeyPair, encryptMessage, decryptMessage, signMessage, verifySignature } from '../../../src/lib/core.utils.js';
import b4a from 'b4a';

describe('core.utils', () => {
    describe('getCoreInfo', () => {
        it('should return core info with default name', () => {
            const mockCore = {
                id: 'test-id',
                discoveryKey: b4a.from('746573742d6b6579', 'hex'), // 'test-key' in hex
                length: 42
            };

            const result = getCoreInfo(mockCore);

            expect(result).toEqual({
                id: 'test-id',
                key: '746573742d6b6579',
                length: 42
            });
        });

        it('should return core info with custom name', () => {
            const mockCore = {
                id: 'test-id',
                discoveryKey: b4a.from('746573742d6b6579', 'hex'), // 'test-key' in hex
                length: 42
            };

            const result = getCoreInfo(mockCore, 'custom-name');

            expect(result).toEqual({
                id: 'test-id',
                key: '746573742d6b6579',
                length: 42
            });
        });

        it('should handle empty core', () => {
            const mockCore = {
                id: '',
                discoveryKey: b4a.from('', 'hex'),
                length: 0
            };

            const result = getCoreInfo(mockCore);

            expect(result).toEqual({
                id: '',
                key: '',
                length: 0
            });
        });
    });

    describe('generateCellUUID', () => {
        it('should generate a valid UUID format', () => {
            const cellName = 'test-cell';
            const creationTime = '2024-01-01T00:00:00Z';
            const config = { storage: 'memory', path: 'test-path' };

            const uuid = generateCellUUID(cellName, creationTime, config);

            // Check UUID format (8-4-4-4-12)
            expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        });

        it('should generate the same UUID for the same inputs', () => {
            const cellName = 'test-cell';
            const creationTime = '2024-01-01T00:00:00Z';
            const config = { storage: 'memory', path: 'test-path' };

            const uuid1 = generateCellUUID(cellName, creationTime, config);
            const uuid2 = generateCellUUID(cellName, creationTime, config);

            expect(uuid1).toBe(uuid2);
        });

        it('should generate different UUIDs for different inputs', () => {
            const baseConfig = { storage: 'memory', path: 'test-path' };
            
            const uuid1 = generateCellUUID('cell1', '2024-01-01T00:00:00Z', baseConfig);
            const uuid2 = generateCellUUID('cell2', '2024-01-01T00:00:00Z', baseConfig);
            const uuid3 = generateCellUUID('cell1', '2024-01-02T00:00:00Z', baseConfig);
            const uuid4 = generateCellUUID('cell1', '2024-01-01T00:00:00Z', { ...baseConfig, path: 'different-path' });

            expect(uuid1).not.toBe(uuid2);
            expect(uuid1).not.toBe(uuid3);
            expect(uuid1).not.toBe(uuid4);
        });
    });

    describe('key pair operations', () => {
        let keyPair;

        beforeAll(() => {
            keyPair = generateKeyPair();
        });

        it('should generate valid key pair', () => {
            expect(keyPair.publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
            expect(keyPair.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----/);
        });

        it('should encrypt and decrypt messages', () => {
            const message = 'test message';
            const encrypted = encryptMessage(message, keyPair.publicKey);
            const decrypted = decryptMessage(encrypted, keyPair.privateKey);
            expect(decrypted).toBe(message);
        });

        it('should sign and verify messages', () => {
            const message = 'test message';
            const signature = signMessage(message, keyPair.privateKey);
            const isValid = verifySignature(message, signature, keyPair.publicKey);
            expect(isValid).toBe(true);
        });

        it('should reject invalid signatures', () => {
            const message = 'test message';
            const signature = signMessage(message, keyPair.privateKey);
            const isValid = verifySignature('different message', signature, keyPair.publicKey);
            expect(isValid).toBe(false);
        });
    });
}); 