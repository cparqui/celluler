import b4a from 'b4a';
import Corestore from 'corestore';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROTOCOL, RECORD_TYPES, encodeBody, encodeEvent } from '../../../src/lib/nucleus/events.js';
import { Journal, verifyCoreSignature } from '../../../src/lib/nucleus/journal.js';
import { startCell, testSeed } from '../../helpers/cell.js';
import { createTestDht } from '../../helpers/testnet.js';

describe('journal writes', () => {
    let testnet;
    let dir;

    beforeAll(async () => {
        testnet = await createTestDht();
    });

    afterAll(() => testnet.destroy());

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'celluler-writes-'));
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    async function withRawJournal(seed, write) {
        const store = new Corestore(dir, { primaryKey: seed, unsafe: true });
        const core = store.get({ name: 'journal' });
        await core.ready();
        await write(core);
        await core.close();
        await store.close();
    }

    const genesisBlock = () =>
        encodeEvent({
            v: 1,
            ts: 1,
            prev: null,
            otherParent: null,
            commits: null,
            public: [
                {
                    type: RECORD_TYPES.GENESIS,
                    ts: 1,
                    refs: [],
                    body: encodeBody(RECORD_TYPES.GENESIS, { protocol: PROTOCOL, created: 1 })
                }
            ]
        });

    describe('revealed receipts', () => {
        let a;
        let b;

        beforeEach(async () => {
            a = await startCell(testnet, { seed: testSeed(50), name: 'a' });
            b = await startCell(testnet, { seed: testSeed(51), name: 'b' });
            await a.call('registerType', { type: 'msg/receipt', owner: 'message', receipt: true });
            await a.call('registerType', { type: 'test/plain', owner: 'test' });
        });

        afterEach(async () => {
            await a.stop();
            await b.stop();
        });

        it('gives a receipt its own event with the parent as otherParent', async () => {
            const parent = await b.call('getHead');
            await a.call('replicate', { cell: b.cellId, minLength: parent.index + 1 });
            const result = await a.call('record', { type: 'msg/receipt', body: 'r', visibility: 'public', parent });
            expect(result.verified).toBe(true);
            expect((await a.call('getEvent', { index: result.event.index })).otherParent).toEqual(parent);
        });

        it('rejects a parent on a non-receipt type, or a malformed parent', async () => {
            const parent = await b.call('getHead');
            await expect(a.call('record', { type: 'test/plain', body: 'x', visibility: 'public', parent }))
                .rejects.toMatchObject({ type: 'INVALID_PARENT' });
            await expect(
                a.call('record', { type: 'msg/receipt', body: 'x', visibility: 'public', parent: { ...parent, hash: 'bad' } })
            ).rejects.toThrow('parent.hash');
        });

        it('rejects a parent that contradicts the local copy, without writing', async () => {
            const parent = await b.call('getHead');
            await a.call('replicate', { cell: b.cellId, minLength: parent.index + 1 });
            const before = await a.call('getHead');
            await expect(
                a.call('record', {
                    type: 'msg/receipt',
                    body: 'x',
                    visibility: 'public',
                    parent: { ...parent, hash: 'ee'.repeat(32) }
                })
            ).rejects.toMatchObject({ type: 'REF_HASH_MISMATCH' });
            expect(await a.call('getHead')).toEqual(before);
        });
    });

    describe('concurrency', () => {
        it('keeps a valid chain under concurrent writes', async () => {
            const cell = await startCell(testnet, { seed: testSeed(52), urgentPerMinute: 1000 });
            const peer = await startCell(testnet, { seed: testSeed(53) });
            const peerHead = await peer.call('getHead');
            await cell.call('registerType', { type: 'test/c', owner: 'test' });

            const results = await Promise.all(
                Array.from({ length: 30 }, (_, i) =>
                    i % 3 === 0
                        ? cell.call('sync', { peerHead })
                        : cell.call('record', { type: 'test/c', body: `${i}`, visibility: 'public', urgent: i % 3 === 1 })
                )
            );
            const seqs = results.filter((r) => r.seq !== undefined).map((r) => r.seq);
            expect(new Set(seqs).size).toBe(seqs.length);
            expect(await cell.call('verifyJournal')).toMatchObject({ valid: true, complete: true, signature: true });

            await cell.stop();
            await peer.stop();
        });

        it('lets only one of two concurrent rotations succeed', async () => {
            const cell = await startCell(testnet, { seed: testSeed(54) });
            const outcomes = await Promise.allSettled([
                cell.call('rotateKey', { purpose: 'sign' }),
                cell.call('rotateKey', { purpose: 'sign' })
            ]);
            expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
            expect((await cell.call('getAttestedKeys')).sign.contextVersion).toBe(2);
            expect((await cell.call('verifyJournal')).valid).toBe(true);
            await cell.stop();
        });

        it('keeps pending records when a commit fails', async () => {
            await withRawJournal(testSeed(55), async (core) => {
                const journal = await Journal.open(core, { clock: () => 1000 });
                const record = { type: 'test/x', ts: 1, refs: [], body: b4a.from('keep') };
                await journal.write([record]);
                const bad = { type: RECORD_TYPES.KEY_REVOKE, ts: 1, refs: [], body: encodeBody(RECORD_TYPES.KEY_REVOKE, { publicKey: b4a.alloc(32, 9), reason: null }) };
                await expect(journal.write([bad], { immediate: true })).rejects.toThrow('not active');
                expect(journal.pendingCount).toBe(1);
                expect(core.length).toBe(1);
                expect((await journal.flush()).index).toBe(1);
                expect(await journal.flush()).toBeNull();
            });
        });
    });

    describe('startup recovery', () => {
        it('attests keys if a crash happened right after genesis', async () => {
            await withRawJournal(testSeed(56), (core) => core.append(genesisBlock()));
            const cell = await startCell(testnet, { seed: testSeed(56), storage: 'file', path: dir });
            const keys = await cell.call('getAttestedKeys');
            expect(Object.values(keys).every((key) => key?.contextVersion === 1)).toBe(true);
            expect((await cell.call('verifyJournal')).valid).toBe(true);
            await cell.stop();
        });

        it('refuses a corrupt journal', async () => {
            await withRawJournal(testSeed(57), (core) => core.append(b4a.from('garbage')));
            await expect(startCell(testnet, { seed: testSeed(57), storage: 'file', path: dir }))
                .rejects.toMatchObject({ name: 'JournalError' });
        });

        it('refuses attested keys that the seed did not derive', async () => {
            await withRawJournal(testSeed(58), async (core) => {
                const journal = await Journal.open(core, { clock: () => 1000 });
                const records = ['sign', 'box', 'swarm'].map((purpose, i) => ({
                    type: RECORD_TYPES.KEY_ADD,
                    ts: 1,
                    refs: [],
                    body: encodeBody(RECORD_TYPES.KEY_ADD, { purpose, publicKey: b4a.alloc(32, i + 1), contextVersion: 1 })
                }));
                await journal.write(records, { immediate: true });
            });
            await expect(startCell(testnet, { seed: testSeed(58), storage: 'file', path: dir }))
                .rejects.toThrow('does not match the root seed');
        });
    });

    describe('verifyCoreSignature', () => {
        it('returns null when the signed head is not held locally', async () => {
            const core = {
                state: { signature: b4a.alloc(64) },
                signedLength: 3,
                fork: 0,
                manifest: { quorum: 1, signers: [{}] },
                has: async () => false
            };
            expect(await verifyCoreSignature(core)).toBeNull();
        });

        it('rejects manifests that are not a single signer', async () => {
            const base = { state: { signature: b4a.alloc(64) }, signedLength: 1, fork: 0 };
            expect(await verifyCoreSignature({ ...base, manifest: { quorum: 1, signers: [{}, {}] } })).toBe(false);
            expect(await verifyCoreSignature({ ...base, manifest: null })).toBe(false);
        });
    });
});
