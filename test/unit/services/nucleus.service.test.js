import b4a from 'b4a';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServiceBroker } from 'moleculer';
import Corestore from 'corestore';
import { RECORD_TYPES } from '../../../src/lib/nucleus/events.js';
import NucleusService from '../../../src/services/nucleus.service.js';
import { fixedClock, startCell, testSeed } from '../../helpers/cell.js';
import { createTestDht } from '../../helpers/testnet.js';

describe('NucleusService', () => {
    let testnet;
    let cell;
    let dir;

    beforeAll(async () => {
        testnet = await createTestDht();
    });

    afterAll(async () => {
        await testnet.destroy();
    });

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'celluler-nucleus-test-'));
        cell = await startCell(testnet, { seed: testSeed(0), clock: fixedClock() });
    });

    afterEach(async () => {
        await cell.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('identity and genesis', () => {
        it('gives a reproducible cell ID for a seed', async () => {
            const again = await startCell(testnet, { seed: testSeed(0) });
            const other = await startCell(testnet, { seed: testSeed(1) });
            expect(cell.cellId).toMatch(/^[0-9a-f]{64}$/);
            expect(again.cellId).toBe(cell.cellId);
            expect(other.cellId).not.toBe(cell.cellId);
            await again.stop();
            await other.stop();
        });

        it('writes genesis with no public name, then one key attestation event', async () => {
            const genesis = await cell.call('getEvent', { index: 0 });
            expect(genesis.prev).toBeNull();
            expect(genesis.public).toHaveLength(1);
            expect(genesis.public[0].type).toBe(RECORD_TYPES.GENESIS);
            expect(Object.keys(genesis.public[0].decoded).sort()).toEqual(['created', 'protocol']);
            expect(genesis.public[0].decoded.protocol).toBe('celluler/1');

            const keys = await cell.call('getEvent', { index: 1 });
            expect(keys.prev).toBe(genesis.hash);
            expect(keys.public.map((r) => r.decoded.purpose)).toEqual(['sign', 'box', 'swarm']);
        });

        it('authenticates the swarm with the attested swarm key', async () => {
            const { swarm } = await cell.call('getAttestedKeys');
            expect(b4a.toString(cell.service.swarm.keyPair.publicKey, 'hex')).toBe(swarm.publicKey);
        });

        it('keeps its identity and journal across a file-storage restart', async () => {
            const first = await startCell(testnet, { seed: undefined, storage: 'file', path: dir });
            await first.call('registerType', { type: 'test/a', owner: 'test' });
            await first.call('record', { type: 'test/a', body: 'x', visibility: 'public', urgent: true });
            const head = await first.call('getHead');
            await first.stop();

            const second = await startCell(testnet, { seed: undefined, storage: 'file', path: dir });
            expect(second.cellId).toBe(first.cellId);
            expect(await second.call('getHead')).toEqual(head);
            await second.stop();
        });

        it('warns in memory mode', async () => {
            const broker = new ServiceBroker({ logger: false, nodeID: 'warn-test' });
            const service = new NucleusService(broker, {
                config: { storage: 'memory', seed: testSeed(2), dht: { bootstrap: testnet.bootstrap } }
            });
            const warn = jest.spyOn(service.logger, 'warn');
            await broker.start();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('will not persist'));
            await broker.stop();
        });

        it('never publishes the seed', async () => {
            const services = await cell.broker.call('$node.services', { withActions: false });
            expect(JSON.stringify(services)).not.toContain(b4a.toString(testSeed(0), 'hex'));
            expect(cell.service.settings.seed).toBeUndefined();
            expect(cell.service.cellConfig.config.seed).toBeUndefined();
        });

        it('fails startup on a bad storage type or a mismatched seed', async () => {
            await expect(startCell(testnet, { storage: 'nope' })).rejects.toThrow('Invalid storage type');
            const first = await startCell(testnet, { seed: testSeed(4), storage: 'file', path: dir });
            await first.stop();
            await expect(startCell(testnet, { seed: testSeed(5), storage: 'file', path: dir }))
                .rejects.toThrow('does not match the identity');
        });

        it('fails loudly if a cell is created without the test bootstrap', async () => {
            const broker = new ServiceBroker({ logger: false, nodeID: 'guard-test' });
            new NucleusService(broker, { config: { storage: 'memory', seed: testSeed(6) } });
            await expect(broker.start()).rejects.toThrow('Offline test guard');
        });
    });

    describe('record', () => {
        beforeEach(() => cell.call('registerType', { type: 'test/note', owner: 'test' }));

        const publicNote = (over = {}) => ({ type: 'test/note', body: b4a.from('hi'), visibility: 'public', ...over });

        it('rejects an unregistered type', async () => {
            await expect(cell.call('record', publicNote({ type: 'test/other' }))).rejects.toThrow('Unregistered');
        });

        it('rejects callers writing Nucleus key records', async () => {
            await expect(cell.call('record', publicNote({ type: RECORD_TYPES.KEY_ADD }))).rejects.toThrow('Unregistered');
            await expect(cell.call('registerType', { type: 'nucleus/x', owner: 'evil' })).rejects.toThrow('reserved');
        });

        it('returns not-implemented for private records', async () => {
            await expect(cell.call('record', publicNote({ visibility: 'private' }))).rejects.toMatchObject({
                code: 501,
                type: 'NOT_IMPLEMENTED'
            });
        });

        it('queues a public record until the next event', async () => {
            const before = (await cell.call('getHead')).index;
            const result = await cell.call('record', publicNote());
            expect(result.event).toBeNull();
            expect((await cell.call('getHead')).index).toBe(before);
            expect((await cell.call('health')).metrics.pendingRecords).toBe(1);
        });

        it('publishes an urgent record with everything pending', async () => {
            await cell.call('record', publicNote({ body: 'one' }));
            const { event } = await cell.call('record', publicNote({ body: 'two', urgent: true }));
            const stored = await cell.call('getEvent', { index: event.index });
            expect(stored.public.map((r) => b4a.toString(b4a.from(r.body, 'hex')))).toEqual(['one', 'two']);
        });

        it('rate-limits urgent records without losing them', async () => {
            const limited = await startCell(testnet, { seed: testSeed(7), urgentPerMinute: 1 });
            await limited.call('registerType', { type: 'test/note', owner: 'test' });
            expect((await limited.call('record', publicNote({ urgent: true }))).event).not.toBeNull();
            const second = await limited.call('record', publicNote({ urgent: true }));
            expect(second).toMatchObject({ event: null, rateLimited: true });
            expect((await limited.call('health')).metrics.pendingRecords).toBe(1);
            await limited.stop();
        });

        it('starts a new event when pending records would exceed 8 KB', async () => {
            const start = (await cell.call('getHead')).index;
            for (let i = 0; i < 9; i++) {
                await cell.call('record', publicNote({ body: b4a.alloc(1024, i) }));
            }
            expect((await cell.call('getHead')).index).toBe(start + 1);
        });

        it('rejects an oversized body and bad refs', async () => {
            await expect(cell.call('record', publicNote({ body: b4a.alloc(1025) }))).rejects.toThrow('exceeds');
            await expect(cell.call('record', publicNote({ body: 42 }))).rejects.toThrow('bytes');
            await expect(
                cell.call('record', publicNote({ refs: [{ cell: 'bad', index: 0, hash: 'bad' }] }))
            ).rejects.toThrow('refs[0].cell');
        });

        it('flushes queued records on clean stop', async () => {
            const first = await startCell(testnet, { seed: undefined, storage: 'file', path: dir });
            await first.call('registerType', { type: 'test/note', owner: 'test' });
            await first.call('record', publicNote());
            await first.stop();
            const second = await startCell(testnet, { seed: undefined, storage: 'file', path: dir });
            const { events } = await second.call('query', { type: 'test/note' });
            expect(events).toHaveLength(1);
            await second.stop();
        });

        it('allows a nucleus/profile record and handles type ownership', async () => {
            await expect(cell.call('record', publicNote({ type: RECORD_TYPES.PROFILE }))).resolves.toBeDefined();
            await expect(cell.call('registerType', { type: 'test/note', owner: 'test' })).resolves.toBeDefined();
            await expect(cell.call('registerType', { type: 'test/note', owner: 'other' })).rejects.toThrow('owned by');
            await expect(cell.call('registerType', { type: 'Bad', owner: 'x' })).rejects.toThrow('Invalid type');
        });
    });

    describe('reading', () => {
        it('reads events by index and rejects unknown ones', async () => {
            expect((await cell.call('getEvent', { index: 1 })).index).toBe(1);
            await expect(cell.call('getEvent', { index: 99 })).rejects.toThrow('does not exist');
        });

        it('queries by type, range and limit with pagination', async () => {
            await cell.call('registerType', { type: 'test/q', owner: 'test' });
            for (let i = 0; i < 3; i++) {
                await cell.call('record', { type: 'test/q', body: `${i}`, visibility: 'public', urgent: true });
            }
            expect((await cell.call('query', { type: 'test/q' })).events.map((e) => e.index)).toEqual([2, 3, 4]);
            expect((await cell.call('query', { from: 1, to: 3 })).events.map((e) => e.index)).toEqual([1, 2]);
            const page = await cell.call('query', { type: 'test/q', limit: 2 });
            expect(page.events).toHaveLength(2);
            expect((await cell.call('query', { type: 'test/q', from: page.nextIndex })).events).toHaveLength(1);
            expect((await cell.call('query', { hasOtherParent: true })).events).toHaveLength(0);
        });

        it('reports health', async () => {
            const health = await cell.call('health');
            expect(health).toMatchObject({ status: 'healthy', cellId: cell.cellId });
            expect(health.metrics.journalLength).toBe(2);
        });

        it('verifies its own journal', async () => {
            const report = await cell.call('verifyJournal');
            expect(report).toMatchObject({ valid: true, signature: true, length: 2, error: null });
        });

        it('errors for a journal that is not replicated', async () => {
            const unknown = 'ab'.repeat(32);
            await expect(cell.call('getHead', { cell: unknown })).rejects.toThrow('not replicated');
            await expect(cell.call('getEvent', { index: 0, cell: unknown })).rejects.toThrow('not replicated');
        });
    });

    describe('access control', () => {
        it('marks write and secret-key actions as local-only', () => {
            const actions = cell.service.schema.actions;
            for (const name of ['registerType', 'record', 'sync', 'replicate', 'sign', 'verify', 'seal', 'unseal']) {
                expect(actions[name].visibility).toBe('protected');
            }
        });

        it('has removed the old actions', async () => {
            for (const name of ['write', 'getUUID', 'getPublicKey', 'emit']) {
                await expect(cell.call(name, {})).rejects.toThrow();
            }
        });
    });

    describe('named cores', () => {
        it('binds and reads a named core', async () => {
            const bound = await cell.call('bind', { topic: 'test-topic' });
            expect(bound).toMatchObject({ success: true, topic: 'test-topic' });
            const again = await cell.call('bind', { topic: 'test-topic', key: bound.core.key });
            expect(again.core.key).toBe(bound.core.key);
            const got = await cell.call('get', { name: 'test-topic' });
            expect(got.core.key).toBe(bound.core.key);
        });

        it('rejects a discovery key mismatch and a missing topic', async () => {
            await expect(cell.call('bind', { topic: 't', key: 'invalid' })).rejects.toThrow('Discovery key mismatch');
            await expect(cell.call('bind', {})).rejects.toMatchObject({ name: 'ValidationError' });
        });

        it('refuses to bind the journal', async () => {
            await expect(cell.call('bind', { topic: 'journal' })).rejects.toThrow('cannot be bound');
        });

        it('returns journal metadata by default, by name and by key', async () => {
            expect((await cell.call('get')).name).toBe('journal');
            expect((await cell.call('get', { name: 'journal' })).core.length).toBe(2);
            expect((await cell.call('get', { key: cell.cellId })).name).toBe('journal');
        });

        it('gets a core by key and rejects a malformed key', async () => {
            const key = 'cd'.repeat(32);
            expect((await cell.call('get', { key })).name).toBe(key);
            await expect(cell.call('get', { key: 'nope' })).rejects.toThrow('64 lowercase hex');
        });
    });

    describe('lifecycle', () => {
        it('emits the cell ID in started and stopped events', async () => {
            const received = {};
            const broker = new ServiceBroker({ logger: false, nodeID: 'events-test' });
            broker.createService({
                name: 'listener',
                events: {
                    'nucleus.started': (ctx) => { received.started = ctx.params; },
                    'nucleus.stopped': (ctx) => { received.stopped = ctx.params; }
                }
            });
            new NucleusService(broker, {
                config: { storage: 'memory', seed: testSeed(8), dht: { bootstrap: testnet.bootstrap } }
            });
            await broker.start();
            const cellId = await broker.call('nucleus.getCellId');
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(received.started).toEqual({ cellId });
            await broker.stop();
            expect(received.stopped).toEqual({ cellId });
        });

        it('releases resources on stop', async () => {
            const stopped = await startCell(testnet, { seed: testSeed(9) });
            await stopped.call('bind', { topic: 'cleanup' });
            await stopped.stop();
            expect(stopped.service.cores).toEqual({});
            expect(stopped.service.swarm).toBeNull();
            expect(stopped.service.store).toBeNull();
            expect(() => stopped.service.cellId).toThrow('not started');
        });
    });
});
