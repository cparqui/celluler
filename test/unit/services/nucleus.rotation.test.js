import b4a from 'b4a';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveKeyPair } from '../../../src/lib/nucleus/keys.js';
import { startCell, testSeed } from '../../helpers/cell.js';
import { createTestDht } from '../../helpers/testnet.js';

describe('Nucleus key rotation', () => {
    let testnet;
    let cell;

    beforeAll(async () => {
        testnet = await createTestDht();
    });

    afterAll(async () => {
        await testnet.destroy();
    });

    beforeEach(async () => {
        cell = await startCell(testnet, { seed: testSeed(20) });
    });

    afterEach(() => cell.stop());

    it.each(['sign', 'box', 'swarm'])('rotates %s with revoke + add in one event', async (purpose) => {
        const before = await cell.call('getAttestedKeys');
        const result = await cell.call('rotateKey', { purpose, reason: 'scheduled' });
        const expected = deriveKeyPair(testSeed(20), purpose, 2).publicKey;

        expect(result).toMatchObject({ purpose, contextVersion: 2, publicKey: b4a.toString(expected, 'hex') });
        const event = await cell.call('getEvent', { index: result.index });
        expect(event.public.map((r) => r.type)).toEqual(['nucleus/key.revoke', 'nucleus/key.add']);
        expect(event.public[0].decoded).toEqual({ publicKey: before[purpose].publicKey, reason: 'scheduled' });

        const after = await cell.call('getAttestedKeys');
        expect(after[purpose]).toEqual({ publicKey: result.publicKey, contextVersion: 2, attestedAt: result.index });
        expect((await cell.call('verifyJournal')).valid).toBe(true);
    });

    it('rotates repeatedly with increasing versions', async () => {
        await cell.call('rotateKey', { purpose: 'sign' });
        const third = await cell.call('rotateKey', { purpose: 'sign' });
        expect(third.contextVersion).toBe(3);
    });

    it('rejects an unknown purpose', async () => {
        await expect(cell.call('rotateKey', { purpose: 'store' })).rejects.toMatchObject({ name: 'ValidationError' });
    });

    it('stops verifying signatures from a revoked key', async () => {
        const message = b4a.from('hello');
        const oldSignature = await cell.call('sign', { message });
        expect(await cell.call('verify', { message, signature: oldSignature })).toBe(true);

        await cell.call('rotateKey', { purpose: 'sign' });
        expect(await cell.call('verify', { message, signature: oldSignature })).toBe(false);
        const newSignature = await cell.call('sign', { message });
        expect(await cell.call('verify', { message, signature: newSignature })).toBe(true);
    });

    it('can still open boxes sealed to a retired encryption key', async () => {
        const box = await cell.call('seal', { message: 'before', cell: cell.cellId });
        await cell.call('rotateKey', { purpose: 'box' });
        expect(b4a.toString(await cell.call('unseal', { ciphertext: box }))).toBe('before');
        const newBox = await cell.call('seal', { message: 'after', cell: cell.cellId });
        expect(b4a.toString(await cell.call('unseal', { ciphertext: newBox }))).toBe('after');
    });

    it('rejects a box it cannot open', async () => {
        await expect(cell.call('unseal', { ciphertext: b4a.alloc(64) })).rejects.toThrow('Could not open');
    });

    it('moves the swarm to the new key and keeps its topics', async () => {
        const previous = cell.service.swarm;
        const { publicKey } = await cell.call('rotateKey', { purpose: 'swarm' });
        expect(cell.service.swarm).not.toBe(previous);
        expect(b4a.toString(cell.service.swarm.keyPair.publicKey, 'hex')).toBe(publicKey);
        expect(cell.service.swarm.topics().next().value).toBeDefined();
    });

    it('keeps rotated keys across a restart', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'celluler-rotation-'));
        const first = await startCell(testnet, { seed: testSeed(21), storage: 'file', path: dir });
        await first.call('rotateKey', { purpose: 'swarm' });
        await first.call('rotateKey', { purpose: 'sign' });
        const keys = await first.call('getAttestedKeys');
        const length = (await first.call('health')).metrics.journalLength;
        await first.stop();

        const second = await startCell(testnet, { seed: testSeed(21), storage: 'file', path: dir });
        expect(await second.call('getAttestedKeys')).toEqual(keys);
        expect((await second.call('health')).metrics.journalLength).toBe(length);
        expect(b4a.toString(second.service.swarm.keyPair.publicKey, 'hex')).toBe(keys.swarm.publicKey);
        await second.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
