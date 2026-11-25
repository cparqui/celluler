import { jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    DEFAULT_CONFIG,
    DEFAULT_LOG_LEVELS,
    createMoleculerConfig,
    loadConfig,
    redactConfig,
    startCell
} from '../../src/index.js';
import { createTestDht } from '../helpers/testnet.js';

const SEED = '07'.repeat(32);

describe('index', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'celluler-index-'));
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const writeConfig = (name, content) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, content);
        return file;
    };

    describe('DEFAULT_CONFIG', () => {
        it('starts the nucleus on memory storage', () => {
            expect(DEFAULT_CONFIG.cell.services).toEqual(['nucleus']);
            expect(DEFAULT_CONFIG.cell.config.storage).toBe('memory');
        });
    });

    describe('redactConfig', () => {
        it('hides the seed without changing the original', () => {
            const config = { id: 'x', config: { storage: 'file', seed: SEED } };
            expect(redactConfig(config).config).toEqual({ storage: 'file', seed: '[redacted]' });
            expect(config.config.seed).toBe(SEED);
        });

        it('returns configs without a seed unchanged', () => {
            const config = { id: 'x', config: { storage: 'file' } };
            expect(redactConfig(config)).toBe(config);
            expect(redactConfig(undefined)).toBeUndefined();
        });
    });

    describe('loadConfig', () => {
        it('merges defaults and resolves environment variables', async () => {
            process.env.CELLULER_TEST_NAME = 'from-env';
            const file = writeConfig('a.yaml', 'cell:\n  name: ${CELLULER_TEST_NAME}\n  tags: ["${CELLULER_TEST_NAME}", 1]\n  other: ${CELLULER_UNSET_VAR}\n');
            const config = await loadConfig(file);
            delete process.env.CELLULER_TEST_NAME;
            expect(config.cell.name).toBe('from-env');
            expect(config.cell.tags).toEqual(['from-env', 1]);
            expect(config.cell.other).toBe('${CELLULER_UNSET_VAR}');
            expect(config.cell.namespace).toBe('celluler');
        });

        it('follows extends', async () => {
            writeConfig('base.yaml', 'cell:\n  name: base\n  namespace: base-ns\n');
            const file = writeConfig('child.yaml', 'extends: base.yaml\ncell:\n  name: child\n');
            const config = await loadConfig(file);
            expect(config.cell).toMatchObject({ name: 'child', namespace: 'base-ns' });
            expect(config.extends).toBeUndefined();
        });

        it('normalizes logging configuration', async () => {
            const file = writeConfig('log.yaml', 'cell:\n  logging:\n    level: debug\n');
            const { logging } = (await loadConfig(file)).cell;
            expect(logging.level['**']).toBe('debug');
            expect(logging.level.TRANSIT).toBe(DEFAULT_LOG_LEVELS.TRANSIT);
            expect(logging.output[0].type).toBe('Console');
        });

        it('keeps explicit logging levels and outputs', async () => {
            const file = writeConfig('log2.yaml', 'cell:\n  logging:\n    level:\n      NUCLEUS: warn\n    output:\n      - type: File\n');
            const { logging } = (await loadConfig(file)).cell;
            expect(logging.level.NUCLEUS).toBe('warn');
            expect(logging.output).toEqual([{ type: 'File' }]);
        });

        it('wraps load errors', async () => {
            await expect(loadConfig(path.join(dir, 'missing.yaml'))).rejects.toThrow('Error loading configuration');
        });
    });

    describe('createMoleculerConfig', () => {
        it('maps cell fields', () => {
            const config = createMoleculerConfig({ id: 'n1', namespace: 'ns', performance: { maxCallLevel: 5 } });
            expect(config).toMatchObject({ nodeID: 'n1', namespace: 'ns', maxCallLevel: 5 });
        });

        it('never logs the seed in debug mode', () => {
            createMoleculerConfig({ id: 'n1', namespace: 'ns', config: { seed: SEED } }, true);
            const output = console.log.mock.calls.flat().join(' ');
            expect(output).toContain('[redacted]');
            expect(output).not.toContain(SEED);
        });
    });

    describe('startCell', () => {
        let testnet;

        beforeEach(async () => {
            testnet = await createTestDht();
        });

        afterEach(() => testnet.destroy());

        const cellConfig = (services) => ({
            cell: {
                id: `index-test-${process.hrtime.bigint()}`,
                namespace: 'index-test',
                logger: false,
                services,
                registry: { stopDelay: 0 },
                config: { storage: 'memory', seed: SEED, dht: { bootstrap: testnet.bootstrap } }
            }
        });

        it('starts a cell from a service list', async () => {
            const broker = await startCell(cellConfig(['nucleus']));
            expect(await broker.call('nucleus.getCellId')).toMatch(/^[0-9a-f]{64}$/);
            await broker.stop();
        });

        it('accepts a single service name and logs in debug mode', async () => {
            const broker = await startCell(cellConfig('nucleus'), true);
            expect(console.log.mock.calls.flat().join(' ')).not.toContain(SEED);
            await broker.stop();
        });

        it('rejects an unknown service', async () => {
            await expect(startCell(cellConfig(['nope']))).rejects.toThrow('Unknown service: nope');
        });
    });
});
