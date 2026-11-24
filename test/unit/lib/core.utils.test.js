import { getCoreInfo } from '../../../src/lib/core.utils.js';
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
});
