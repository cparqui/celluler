import b4a from 'b4a';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openCellStore, removeEphemeral } from '../../../../src/lib/nucleus/store.js';

const seed = b4a.alloc(32, 7);

async function journalKey(opened) {
    const core = opened.store.get({ name: 'journal' });
    await core.ready();
    const key = b4a.toString(core.key, 'hex');
    await core.close();
    await opened.store.close();
    await removeEphemeral(opened.ephemeralDirectory);
    return key;
}

describe('openCellStore', () => {
    let dir;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'celluler-store-test-'));
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('gives the same journal key for the same injected seed', async () => {
        const a = await journalKey(await openCellStore({ storage: 'file', path: path.join(dir, 'a'), seed }));
        const b = await journalKey(await openCellStore({ storage: 'memory', seed }));
        expect(a).toBe(b);
    });

    it('persists a generated seed across restarts', async () => {
        const first = await openCellStore({ storage: 'file', path: dir });
        const generated = b4a.toString(first.seed, 'hex');
        const key = await journalKey(first);
        const second = await openCellStore({ storage: 'file', path: dir });
        expect(b4a.toString(second.seed, 'hex')).toBe(generated);
        expect(await journalKey(second)).toBe(key);
    });

    it('rejects an injected seed that differs from the stored one', async () => {
        await journalKey(await openCellStore({ storage: 'file', path: dir, seed }));
        await expect(openCellStore({ storage: 'file', path: dir, seed: b4a.alloc(32, 9) }))
            .rejects.toThrow('does not match the identity');
    });

    it('removes the memory-mode directory', async () => {
        const opened = await openCellStore({ storage: 'memory' });
        expect(fs.existsSync(opened.ephemeralDirectory)).toBe(true);
        await journalKey(opened);
        expect(fs.existsSync(opened.ephemeralDirectory)).toBe(false);
    });

    it('rejects bad configuration', async () => {
        await expect(openCellStore({ storage: 'file' })).rejects.toThrow('Path must be specified');
        await expect(openCellStore({ storage: 'nope' })).rejects.toThrow('Invalid storage type');
        await expect(openCellStore({ storage: 'memory', seed: 'bad' })).rejects.toThrow('Invalid root seed');
    });
});
