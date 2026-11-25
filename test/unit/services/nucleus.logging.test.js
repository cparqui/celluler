import { jest } from '@jest/globals';
import b4a from 'b4a';
import { ServiceBroker } from 'moleculer';
import { RECORD_TYPES } from '../../../src/lib/nucleus/records/index.js';
import NucleusService from '../../../src/services/nucleus.service.js';
import { testSeed } from '../../helpers/cell.js';
import { createTestDht } from '../../helpers/testnet.js';

const LEVELS = ['debug', 'info', 'warn', 'error'];

describe('NucleusService logging', () => {
    let testnet;
    let broker;
    let logs;
    let seed;

    const logged = (level, message) => logs.filter((log) => log.level === level && log.message === message);
    const call = (action, params) => broker.call(`nucleus.${action}`, params);

    beforeAll(async () => {
        testnet = await createTestDht();
    });

    afterAll(async () => {
        await testnet.destroy();
    });

    beforeEach(async () => {
        logs = [];
        seed = testSeed(40);
        broker = new ServiceBroker({ logger: false, nodeID: `logging-${process.hrtime.bigint()}` });
        const service = new NucleusService(broker, {
            config: { storage: 'memory', seed, dht: { bootstrap: testnet.bootstrap } }
        });
        for (const level of LEVELS) {
            // Pino style: an optional context object, then the message.
            jest.spyOn(service.logger, level).mockImplementation((...args) => {
                const fields = typeof args[0] === 'object' ? args.shift() : {};
                logs.push({ level, message: args[0], fields });
            });
        }
        await broker.start();
    });

    afterEach(async () => {
        await broker.stop();
    });

    it('logs startup at info, with the cell ID and journal summary', async () => {
        const cellId = await call('getCellId');
        expect(logged('info', 'Created a new cell journal')).toEqual([
            expect.objectContaining({ fields: { cellId } })
        ]);
        expect(logged('info', 'Attested keys')[0].fields.purposes).toEqual(['sign', 'box', 'swarm']);
        expect(logged('info', 'Nucleus started')[0].fields).toEqual({
            cellId,
            storage: 'memory',
            journalLength: 2,
            publicRecords: 4,
            dht: 'custom bootstrap'
        });
    });

    it('logs each journal append and access at debug only', async () => {
        const appends = logged('debug', 'Appended journal event');
        expect(appends.map((log) => log.fields.records)).toEqual([
            [RECORD_TYPES.GENESIS],
            [RECORD_TYPES.KEY_ADD, RECORD_TYPES.KEY_ADD, RECORD_TYPES.KEY_ADD]
        ]);

        await call('registerType', { type: 'test/note', owner: 'test' });
        await call('record', { type: 'test/note', body: 'hello', visibility: 'public' });
        await call('record', { type: 'test/note', body: 'now', visibility: 'public', urgent: true });
        await call('getEvent', { index: 0 });
        await call('query', { type: 'test/note' });

        expect(logged('info', 'Registered record type')[0].fields).toEqual({
            type: 'test/note',
            owner: 'test',
            receipt: false
        });
        expect(logged('debug', 'Recorded; waiting for the next event')[0].fields).toMatchObject({ pendingRecords: 1 });
        expect(logged('debug', 'Recorded and published')).toHaveLength(1);
        expect(logged('debug', 'Appended journal event').at(-1).fields.records).toEqual(['test/note', 'test/note']);
        expect(logged('debug', 'Read journal event')[0].fields).toEqual({ journal: 'own', index: 0 });
        expect(logged('debug', 'Queried journal')[0].fields).toMatchObject({ matched: 1, nextIndex: null });

        // Nothing about routine reads and writes reaches info.
        const info = logs.filter((log) => log.level === 'info').map((log) => log.message);
        expect(info).not.toContain('Appended journal event');
        expect(info).not.toContain('Read journal event');
        // Record bodies are never logged.
        expect(JSON.stringify(logs)).not.toContain('hello');
    });

    it('logs key rotation at info and never logs the seed', async () => {
        await call('rotateKey', { purpose: 'swarm', reason: 'scheduled' });
        expect(logged('info', 'Rotated key')[0].fields).toMatchObject({
            purpose: 'swarm',
            contextVersion: 2,
            reason: 'scheduled'
        });
        expect(logged('info', 'Restarted swarm with the rotated key')).toHaveLength(1);
        expect(JSON.stringify(logs)).not.toContain(b4a.toString(seed, 'hex'));
    });

    it('logs rejected input at debug and faults at error, then rethrows', async () => {
        await expect(call('getEvent', { index: 99 })).rejects.toThrow('does not exist');
        expect(logged('debug', 'Action rejected')[0].fields).toMatchObject({
            action: 'nucleus.getEvent',
            type: 'EVENT_NOT_FOUND',
            code: 404
        });
        expect(logged('error', 'Action failed')).toHaveLength(0);

        await expect(call('bind', { topic: 'chat', key: 'ff' })).rejects.toThrow('Discovery key mismatch');
        const [failed] = logged('error', 'Action failed');
        expect(failed.fields.action).toBe('nucleus.bind');
        expect(failed.fields.err.message).toContain('Discovery key mismatch');
    });

    it('logs shutdown at info', async () => {
        const cellId = await call('getCellId');
        await call('registerType', { type: 'test/note', owner: 'test' });
        await call('record', { type: 'test/note', body: 'queued', visibility: 'public' });
        await broker.stop();
        expect(logged('info', 'Nucleus stopped')[0].fields).toEqual({ cellId, flushedRecords: 1 });
        broker = new ServiceBroker({ logger: false });
    });
});
