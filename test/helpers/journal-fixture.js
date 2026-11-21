// Builds real, reproducible cell journals linked by sync events, for use as
// test data (including Hashgraph virtual voting).
import b4a from 'b4a';
import sodium from 'sodium-universal';
import { fixedClock, startCell, testSeed } from './cell.js';
import { createTestDht } from './testnet.js';

/** Cycles through the other cells: creator + 1 + (step mod (n - 1)). */
export function roundRobinPartner({ step, creator, cellCount }) {
    return (creator + 1 + (step % (cellCount - 1))) % cellCount;
}

/**
 * The consensus §4.3 rule, `members[H(lastEventHash) mod n]`, moved to the next
 * member if it lands on the creator, since a cell cannot sync with itself.
 */
export function hashPartner({ creator, cellCount, head }) {
    const digest = b4a.alloc(32);
    sodium.crypto_generichash(digest, b4a.from(head.hash, 'hex'));
    const choice = digest.readUInt32LE(0) % cellCount;
    return choice === creator ? (choice + 1) % cellCount : choice;
}

async function readJournal(cell) {
    const events = [];
    let from = 0;
    while (from !== null) {
        const page = await cell.call('query', { from, limit: 1000 });
        events.push(...page.events);
        from = page.nextIndex;
    }
    return { cellId: cell.cellId, events };
}

/**
 * Starts `cells` cells with fixed seeds and clocks and runs `syncs` two-way syncs.
 * At step i, cell (i mod n) syncs with `selectPartner`'s choice: each side
 * replicates the other, then appends a sync event pointing at the other's head.
 *
 * @param {object} options
 * @param {number} [options.cells=3]
 * @param {number} [options.syncs=12]
 * @param {Function} [options.selectPartner=hashPartner] ({ step, creator, cellCount, head }) => cell number
 * @param {object} [options.testnet] an existing testnet; otherwise one is created and destroyed
 * @param {boolean} [options.keepRunning=false] leave cells running; the caller must call `close()`
 * @returns {{ journals: Array<{ cellId, events }>, cells: Array, syncLog: Array, close: Function }}
 */
export async function buildJournalFixture({
    cells: cellCount = 3,
    syncs = 12,
    selectPartner = hashPartner,
    testnet: providedTestnet = null,
    keepRunning = false,
    seedOffset = 100
} = {}) {
    if (!Number.isInteger(cellCount) || cellCount < 2) throw new Error('A fixture needs at least 2 cells');
    if (!Number.isInteger(syncs) || syncs < 0) throw new Error('syncs must be a non-negative integer');

    const testnet = providedTestnet ?? (await createTestDht());
    const cells = [];
    const close = async () => {
        await Promise.all(cells.map((cell) => cell.stop()));
        if (!providedTestnet) await testnet.destroy();
    };

    try {
        for (let i = 0; i < cellCount; i++) {
            const clock = fixedClock(1_700_000_000_000 + i * 1000);
            cells.push(await startCell(testnet, { seed: testSeed(seedOffset + i), clock, name: `fixture-${i}` }));
        }

        const syncLog = [];
        for (let step = 0; step < syncs; step++) {
            const creator = step % cellCount;
            const head = await cells[creator].call('getHead');
            const partner = selectPartner({ step, creator, cellCount, head });
            if (!Number.isInteger(partner) || partner < 0 || partner >= cellCount || partner === creator) {
                throw new Error(`Invalid partner ${partner} for cell ${creator} at step ${step}`);
            }
            const [a, b] = [cells[creator], cells[partner]];
            const [headA, headB] = [head, await b.call('getHead')];

            await a.call('replicate', { cell: b.cellId, minLength: headB.index + 1 });
            await b.call('replicate', { cell: a.cellId, minLength: headA.index + 1 });
            const eventA = await a.call('sync', { peerHead: headB });
            const eventB = await b.call('sync', { peerHead: headA });
            syncLog.push({ step, creator, partner, events: [eventA.index, eventB.index] });
        }

        const journals = await Promise.all(cells.map(readJournal));
        if (!keepRunning) await close();
        return { journals, cells, syncLog, close };
    } catch (err) {
        await close();
        throw err;
    }
}
