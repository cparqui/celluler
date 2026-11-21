import b4a from 'b4a';
import { PROTOCOL, RECORD_TYPES as T, encodeBody, encodeEvent, hashEvent } from '../../../../src/lib/nucleus/events.js';
import {
    JournalError,
    applyBlock,
    createJournalState,
    replayJournal
} from '../../../../src/lib/nucleus/replay.js';

const cell = b4a.alloc(32, 1);
const key = (fill) => b4a.alloc(32, fill);
const rec = (type, body) => ({ type, ts: 1, refs: [], body: encodeBody(type, body) });
const genesis = (protocol = PROTOCOL) => rec(T.GENESIS, { protocol, created: 1 });
const add = (purpose, fill, contextVersion = 1) => rec(T.KEY_ADD, { purpose, publicKey: key(fill), contextVersion });
const revoke = (fill) => rec(T.KEY_REVOKE, { publicKey: key(fill), reason: null });

/** Builds validly linked blocks from lists of records. */
function chain(...recordLists) {
    const blocks = [];
    let prev = null;
    recordLists.forEach((records, index) => {
        const block = encodeEvent({ v: 1, ts: index + 1, prev, otherParent: null, commits: null, public: records });
        blocks.push(block);
        prev = hashEvent(cell, index, block);
    });
    return blocks;
}

describe('replayJournal', () => {
    it('tracks length, head and attested keys', () => {
        const blocks = chain([genesis()], [add('sign', 2), add('box', 3), add('swarm', 4)]);
        const state = replayJournal(cell, blocks);
        expect(state.length).toBe(2);
        expect(b4a.equals(state.head, hashEvent(cell, 1, blocks[1]))).toBe(true);
        expect(state.publicRecords).toBe(4);
        expect(state.lastTs).toBe(2);
        expect(b4a.equals(state.keys.sign.publicKey, key(2))).toBe(true);
        expect(state.keys.box.attestedAt).toBe(1);
    });

    it('applies revoke + add rotation in one event', () => {
        const state = replayJournal(cell, chain([genesis()], [add('sign', 2)], [revoke(2), add('sign', 5, 2)]));
        expect(state.keys.sign.contextVersion).toBe(2);
        expect(b4a.equals(state.keys.sign.publicKey, key(5))).toBe(true);
    });

    it('leaves a purpose without a key after a bare revoke', () => {
        expect(replayJournal(cell, chain([genesis()], [add('sign', 2)], [revoke(2)])).keys.sign).toBeNull();
    });

    it.each([
        ['a second active key', [[genesis()], [add('sign', 2), add('sign', 3, 2)]], 'already has an active key'],
        ['a non-increasing version', [[genesis()], [add('sign', 2, 2)], [revoke(2), add('sign', 3, 2)]], 'must increase'],
        ['a reused key', [[genesis()], [add('sign', 2)], [revoke(2), add('sign', 2, 2)]], 'already attested'],
        ['a key reused across purposes', [[genesis()], [add('sign', 2), add('swarm', 2)]], 'already attested'],
        ['an unknown purpose', [[genesis()], [add('store', 2)]], 'unknown key purpose'],
        ['revoking an inactive key', [[genesis()], [revoke(2)]], 'not active'],
        ['a second genesis', [[genesis()], [genesis()]], 'only valid in block 0'],
        ['a wrong protocol', [[genesis('other/1')]], 'unsupported protocol'],
        ['a block 0 without genesis', [[add('sign', 2)]], 'exactly one nucleus/genesis'],
        ['extra records in block 0', [[genesis(), add('sign', 2)]], 'exactly one nucleus/genesis']
    ])('rejects %s', (_name, lists, message) => {
        expect(() => replayJournal(cell, chain(...lists))).toThrow(message);
    });

    it('rejects a malformed key body', () => {
        const bad = { type: T.KEY_ADD, ts: 1, refs: [], body: b4a.from([1]) };
        expect(() => replayJournal(cell, chain([genesis()], [bad]))).toThrow(JournalError);
    });

    it('rejects a genesis with parents', () => {
        const block = encodeEvent({ v: 1, ts: 1, prev: key(9), otherParent: null, commits: null, public: [genesis()] });
        expect(() => replayJournal(cell, [block])).toThrow('no parents');
    });

    it('rejects a broken or missing prev link', () => {
        const [first] = chain([genesis()]);
        const wrong = encodeEvent({ v: 1, ts: 2, prev: key(9), otherParent: null, commits: null, public: [] });
        const missing = encodeEvent({ v: 1, ts: 2, prev: null, otherParent: null, commits: null, public: [] });
        expect(() => replayJournal(cell, [first, wrong])).toThrow('prev does not match');
        expect(() => replayJournal(cell, [first, missing])).toThrow('prev does not match');
    });

    it('rejects an otherParent naming the same cell', () => {
        const [first] = chain([genesis()]);
        const prev = hashEvent(cell, 0, first);
        const otherParent = { cell, index: 0, hash: prev };
        const block = encodeEvent({ v: 1, ts: 2, prev, otherParent, commits: null, public: [] });
        expect(() => replayJournal(cell, [first, block])).toThrow('another cell');
    });

    it('reports the failing index and rejects undecodable blocks', () => {
        const state = createJournalState(cell);
        applyBlock(state, chain([genesis()])[0]);
        let error;
        try {
            applyBlock(state, b4a.from('garbage'));
        } catch (err) {
            error = err;
        }
        expect(error).toBeInstanceOf(JournalError);
        expect(error.index).toBe(1);
    });

    it('binds hashes to the cell, so another cell cannot replay the chain', () => {
        const blocks = chain([genesis()], [add('sign', 2)]);
        expect(() => replayJournal(key(8), blocks)).toThrow('prev does not match');
    });
});
