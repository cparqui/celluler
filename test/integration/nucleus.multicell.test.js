import b4a from 'b4a';
import Corestore from 'corestore';
import Hyperswarm from 'hyperswarm';
import { ServiceBroker } from 'moleculer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyCoreSignature } from '../../src/lib/nucleus/journal.js';
import { startCell, testSeed } from '../helpers/cell.js';
import { buildJournalFixture, hashPartner, roundRobinPartner } from '../helpers/journal-fixture.js';
import { createTestDht } from '../helpers/testnet.js';

describe('multi-cell journals', () => {
    let testnet;

    beforeAll(async () => {
        testnet = await createTestDht();
    });

    afterAll(async () => {
        await testnet.destroy();
    });

    describe('two cells', () => {
        let a;
        let b;

        beforeEach(async () => {
            a = await startCell(testnet, { seed: testSeed(30), name: 'a' });
            b = await startCell(testnet, { seed: testSeed(31), name: 'b' });
        });

        afterEach(async () => {
            await a.stop();
            await b.stop();
        });

        it('replicates and verifies a peer journal', async () => {
            const head = await b.call('getHead');
            const result = await a.call('replicate', { cell: b.cellId, minLength: head.index + 1 });
            expect(result).toMatchObject({ cell: b.cellId, length: head.index + 1, head });

            const report = await a.call('verifyJournal', { cell: b.cellId });
            expect(report).toMatchObject({ valid: true, signature: true, head: head.hash });
            expect(report.keys).toEqual(await b.call('getAttestedKeys'));
            expect(await a.call('getAttestedKeys', { cell: b.cellId })).toEqual(await b.call('getAttestedKeys'));
            expect(await a.call('getEvent', { index: 0, cell: b.cellId })).toEqual(await b.call('getEvent', { index: 0 }));
        });

        it('emits sync events referencing each other', async () => {
            const headA = await a.call('getHead');
            const headB = await b.call('getHead');
            await a.call('replicate', { cell: b.cellId, minLength: headB.index + 1 });
            await b.call('replicate', { cell: a.cellId, minLength: headA.index + 1 });

            const syncA = await a.call('sync', { peerHead: headB });
            const syncB = await b.call('sync', { peerHead: headA });
            expect(syncA.verified).toBe(true);
            expect(syncB.verified).toBe(true);
            expect((await a.call('getEvent', { index: syncA.index })).otherParent).toEqual(headB);
            expect((await a.call('query', { hasOtherParent: true })).events).toHaveLength(1);
        });

        it('rejects a Ref whose hash contradicts the local copy', async () => {
            const head = await b.call('getHead');
            await a.call('replicate', { cell: b.cellId, minLength: head.index + 1 });
            await expect(a.call('sync', { peerHead: { ...head, hash: 'ff'.repeat(32) } }))
                .rejects.toMatchObject({ type: 'REF_HASH_MISMATCH' });
        });

        it('accepts a well-formed Ref to a journal it does not hold, marked unverified', async () => {
            const result = await a.call('sync', { peerHead: await b.call('getHead') });
            expect(result.verified).toBe(false);
        });

        it('treats an index beyond the local copy as unverified', async () => {
            const head = await b.call('getHead');
            await a.call('replicate', { cell: b.cellId, minLength: head.index + 1 });
            const result = await a.call('sync', { peerHead: { ...head, index: head.index + 5 } });
            expect(result.verified).toBe(false);
        });

        it('rejects malformed Refs and self-references', async () => {
            const own = await a.call('getHead');
            await expect(a.call('sync', { peerHead: own })).rejects.toThrow('another cell');
            await expect(a.call('sync', { peerHead: { cell: 'x', index: 0, hash: 'y' } })).rejects.toThrow('cell');
            await expect(a.call('sync', { peerHead: { cell: b.cellId, index: -1, hash: own.hash } }))
                .rejects.toMatchObject({ name: 'ValidationError' });
        });

        it('rejects replicating itself or a malformed ID, and times out on an absent cell', async () => {
            await expect(a.call('replicate', { cell: a.cellId })).rejects.toThrow('own journal');
            await expect(a.call('replicate', { cell: 'nope' })).rejects.toThrow('64 lowercase hex');
            await expect(a.call('replicate', { cell: 'ab'.repeat(32), timeout: 100 }))
                .rejects.toMatchObject({ type: 'REPLICATION_TIMEOUT' });
        });

        it('signs and verifies across cells with attested keys', async () => {
            await a.call('replicate', { cell: b.cellId, minLength: 2 });
            const message = b4a.from('from b');
            const signature = await b.call('sign', { message });
            expect(await a.call('verify', { message, signature, cell: b.cellId })).toBe(true);
            expect(await a.call('verify', { message: 'other', signature, cell: b.cellId })).toBe(false);
        });

        it('seals to a peer, and only the peer can open it', async () => {
            await a.call('replicate', { cell: b.cellId, minLength: 2 });
            const ciphertext = await a.call('seal', { message: 'secret', cell: b.cellId });
            expect(b4a.toString(await b.call('unseal', { ciphertext }))).toBe('secret');
            await expect(a.call('unseal', { ciphertext })).rejects.toThrow('Could not open');
        });

        it('requires a replicated journal for peer crypto', async () => {
            await expect(a.call('seal', { message: 'x', cell: b.cellId })).rejects.toThrow('not replicated');
            await expect(a.call('verify', { message: 'x', signature: b4a.alloc(64), cell: b.cellId }))
                .rejects.toThrow('not replicated');
        });

        it('sees a peer key rotation and stops trusting the old key', async () => {
            await a.call('replicate', { cell: b.cellId, minLength: 2 });
            const message = b4a.from('hello');
            const oldSignature = await b.call('sign', { message });
            const rotation = await b.call('rotateKey', { purpose: 'sign' });

            await a.call('replicate', { cell: b.cellId, minLength: rotation.index + 1 });
            expect((await a.call('getAttestedKeys', { cell: b.cellId })).sign.contextVersion).toBe(2);
            expect(await a.call('verify', { message, signature: oldSignature, cell: b.cellId })).toBe(false);
            const newSignature = await b.call('sign', { message });
            expect(await a.call('verify', { message, signature: newSignature, cell: b.cellId })).toBe(true);
        });
    });

    describe('a peer serving an invalid journal', () => {
        it('is rejected even though Hypercore signed it', async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'celluler-forged-'));
            const store = new Corestore(dir);
            const forged = store.get({ name: 'journal' });
            await forged.ready();
            await forged.append(b4a.from('not an event'));
            const swarm = new Hyperswarm({ bootstrap: testnet.bootstrap });
            swarm.on('connection', (conn) => {
                conn.on('error', () => {});
                store.replicate(conn);
            });
            await swarm.join(forged.discoveryKey).flushed();

            const cell = await startCell(testnet, { seed: testSeed(32) });
            const id = b4a.toString(forged.key, 'hex');
            await expect(cell.call('replicate', { cell: id })).rejects.toMatchObject({ type: 'INVALID_JOURNAL' });
            expect(await cell.call('verifyJournal', { cell: id })).toMatchObject({ valid: false });

            await cell.stop();
            await swarm.destroy();
            await forged.close();
            await store.close();
            fs.rmSync(dir, { recursive: true, force: true });
        });
    });

    describe('signature verification', () => {
        it('rejects a tampered signature', async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'celluler-sig-'));
            const store = new Corestore(dir);
            const core = store.get({ name: 'journal' });
            await core.ready();
            await core.append(b4a.from('block'));
            expect(await verifyCoreSignature(core)).toBe(true);

            const tampered = b4a.from(core.state.signature);
            tampered[tampered.byteLength - 1] ^= 1;
            expect(await verifyCoreSignature(core, tampered)).toBe(false);
            expect(await verifyCoreSignature(core, b4a.from('x'))).toBe(false);

            await core.close();
            await store.close();
            fs.rmSync(dir, { recursive: true, force: true });
        });
    });

    describe('action visibility across nodes', () => {
        it('blocks another node from write and secret-key actions but allows reads', async () => {
            const namespace = `visibility-${process.pid}`;
            const local = new ServiceBroker({ logger: false, nodeID: 'local', namespace, transporter: 'Fake' });
            const remote = new ServiceBroker({ logger: false, nodeID: 'remote', namespace, transporter: 'Fake' });
            const { default: NucleusService } = await import('../../src/services/nucleus.service.js');
            new NucleusService(local, {
                config: { storage: 'memory', seed: testSeed(33), dht: { bootstrap: testnet.bootstrap } }
            });
            await Promise.all([local.start(), remote.start()]);
            await remote.waitForServices('nucleus');

            expect(await remote.call('nucleus.getCellId')).toMatch(/^[0-9a-f]{64}$/);
            for (const action of ['record', 'sign', 'unseal', 'rotateKey', 'sync', 'registerType']) {
                await expect(remote.call(`nucleus.${action}`, {})).rejects.toMatchObject({ name: 'ServiceNotFoundError' });
            }
            await remote.stop();
            await local.stop();
        });
    });

    describe('journal fixture', () => {
        it('is reproducible', async () => {
            const first = await buildJournalFixture({ testnet, cells: 3, syncs: 6 });
            const second = await buildJournalFixture({ testnet, cells: 3, syncs: 6 });
            expect(second.journals).toEqual(first.journals);
            expect(second.syncLog).toEqual(first.syncLog);
        });

        it('produces a valid, well-linked DAG', async () => {
            const { journals, syncLog } = await buildJournalFixture({ testnet, cells: 4, syncs: 8, seedOffset: 120 });
            const byHash = new Map(journals.flatMap((j) => j.events.map((e) => [e.hash, { cell: j.cellId, event: e }])));

            expect(syncLog).toHaveLength(8);
            expect(journals.reduce((sum, j) => sum + j.events.length, 0)).toBe(4 * 2 + 16);
            for (const journal of journals) {
                journal.events.forEach((event, i) => {
                    expect(event.prev).toBe(i === 0 ? null : journal.events[i - 1].hash);
                    if (event.otherParent) {
                        const parent = byHash.get(event.otherParent.hash);
                        expect(parent.cell).toBe(event.otherParent.cell);
                        expect(parent.cell).not.toBe(journal.cellId);
                        expect(parent.event.index).toBe(event.otherParent.index);
                    }
                });
            }
        });

        it('accepts a custom partner function and keeps cells running on request', async () => {
            const selectPartner = jest.fn(roundRobinPartner);
            const fixture = await buildJournalFixture({
                testnet, cells: 2, syncs: 2, selectPartner, keepRunning: true, seedOffset: 130
            });
            expect(selectPartner).toHaveBeenCalledTimes(2);
            expect((await fixture.cells[0].call('verifyJournal')).valid).toBe(true);
            expect((await fixture.cells[0].call('verifyJournal', { cell: fixture.cells[1].cellId })).valid).toBe(true);
            await fixture.close();
        });

        it('creates its own testnet when none is given', async () => {
            const { journals } = await buildJournalFixture({ cells: 2, syncs: 1, seedOffset: 140 });
            expect(journals).toHaveLength(2);
        });

        it('rejects bad options and invalid partners', async () => {
            await expect(buildJournalFixture({ testnet, cells: 1 })).rejects.toThrow('at least 2');
            await expect(buildJournalFixture({ testnet, syncs: -1 })).rejects.toThrow('non-negative');
            await expect(
                buildJournalFixture({ testnet, cells: 2, syncs: 1, selectPartner: ({ creator }) => creator, seedOffset: 150 })
            ).rejects.toThrow('Invalid partner');
        });

        it('hashPartner never picks the creator', () => {
            for (let i = 0; i < 64; i++) {
                const head = { hash: b4a.toString(b4a.alloc(32, i), 'hex') };
                for (let creator = 0; creator < 3; creator++) {
                    const partner = hashPartner({ creator, cellCount: 3, head });
                    expect(partner).not.toBe(creator);
                    expect(partner).toBeGreaterThanOrEqual(0);
                    expect(partner).toBeLessThan(3);
                }
            }
        });
    });
});
