import { ServiceBroker } from 'moleculer';
import NucleusService from '../../../src/services/nucleus.service.js';
import { testSeed } from '../../helpers/cell.js';
import { createTestDht } from '../../helpers/testnet.js';

// Runs a Nucleus with Moleculer's Pino logger and checks what Pino writes.
describe('NucleusService with the Pino logger', () => {
    let testnet;
    let output;

    beforeAll(async () => {
        testnet = await createTestDht();
        output = '';
        const broker = new ServiceBroker({
            nodeID: 'pino-cell',
            logger: {
                type: 'Pino',
                options: { level: 'debug', pino: { destination: { write: (chunk) => (output += chunk) } } }
            }
        });
        new NucleusService(broker, {
            config: { storage: 'memory', seed: testSeed(50), dht: { bootstrap: testnet.bootstrap } }
        });
        await broker.start();
        await broker.call('nucleus.bind', { topic: 'chat', key: 'ff' }).catch(() => {});
        await broker.stop();
    });

    afterAll(async () => {
        await testnet.destroy();
    });

    const lines = () => output.trim().split('\n');
    const nucleus = () => lines().map((line) => JSON.parse(line)).filter((line) => line.mod === 'nucleus');

    it('writes one JSON object per line', () => {
        expect(lines().length).toBeGreaterThan(5);
        for (const line of lines()) expect(() => JSON.parse(line)).not.toThrow();
    });

    it('puts context in fields and the message in msg', () => {
        const started = nucleus().find((line) => line.msg === 'Nucleus started');
        expect(started).toMatchObject({ level: 30, nodeID: 'pino-cell', storage: 'memory', journalLength: 2 });
        expect(started.cellId).toMatch(/^[0-9a-f]{64}$/);

        const append = nucleus().find((line) => line.msg === 'Appended journal event');
        expect(append).toMatchObject({ level: 20, index: 0, records: ['nucleus/genesis'], otherParent: null });
    });

    it('serializes errors under err, with the stack', () => {
        const failed = nucleus().find((line) => line.msg === 'Action failed');
        expect(failed).toMatchObject({ level: 50, action: 'nucleus.bind', err: { type: 'Error' } });
        expect(failed.err.message).toContain('Discovery key mismatch');
        expect(failed.err.stack).toContain('nucleus.service.js');
    });
});
