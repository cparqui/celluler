import b4a from 'b4a';
import {
    EventFormatError,
    MAX_EVENT_PUBLIC_BYTES,
    MAX_RECORD_BODY_BYTES,
    assertRef,
    decodeEvent,
    encodeEvent,
    hashEvent,
    isValidType,
    publicRecordsSize
} from '../../../../src/lib/nucleus/events.js';
import { PROTOCOL, RECORD_TYPES, decodeBody, encodeBody } from '../../../../src/lib/nucleus/records/index.js';

const bytes = (fill) => b4a.alloc(32, fill);
const ref = { cell: bytes(1), index: 5, hash: bytes(2) };
const record = (over = {}) => ({ type: 'test/thing', ts: 1000, refs: [], body: b4a.from('body'), ...over });
const event = (over = {}) => ({ v: 1, ts: 1000, prev: null, otherParent: null, commits: null, public: [], ...over });

describe('event encoding', () => {
    it('round-trips an event with every field', () => {
        const input = event({ prev: bytes(3), otherParent: ref, commits: bytes(4), public: [record({ refs: [ref] })] });
        expect(decodeEvent(encodeEvent(input))).toEqual(input);
    });

    it('round-trips an event with only required fields and an empty body', () => {
        const input = event({ public: [record({ body: b4a.alloc(0) })] });
        expect(decodeEvent(encodeEvent(input))).toEqual(input);
    });

    it('is deterministic and pins the wire format', () => {
        const input = event({ prev: bytes(3), public: [record()] });
        expect(b4a.equals(encodeEvent(input), encodeEvent({ ...input }))).toBe(true);
        expect(b4a.toString(encodeEvent(event()), 'hex')).toBe('01fde8030000');
    });

    it('rejects trailing bytes', () => {
        const block = b4a.concat([encodeEvent(event()), b4a.from([0])]);
        expect(() => decodeEvent(block)).toThrow('not canonically encoded');
    });

    it('rejects non-minimal integers', () => {
        const block = b4a.from('01fee80300000000' + '0000', 'hex');
        expect(() => decodeEvent(block)).toThrow('not canonically encoded');
    });

    it('rejects unknown flags', () => {
        expect(() => decodeEvent(b4a.from('01fde8030800', 'hex'))).toThrow('not canonically encoded');
    });

    it('rejects truncated and unsupported blocks', () => {
        expect(() => decodeEvent(b4a.from('01', 'hex'))).toThrow(EventFormatError);
        expect(() => decodeEvent(encodeEvent(event()).fill(2, 0, 1))).toThrow('Unsupported event version');
    });

    it.each([
        ['bad version', event({ v: 2 }), 'Unsupported event version'],
        ['negative ts', event({ ts: -1 }), 'event.ts'],
        ['short prev', event({ prev: b4a.alloc(3) }), 'event.prev'],
        ['bad otherParent', event({ otherParent: { ...ref, index: 1.5 } }), 'otherParent.index'],
        ['short commits', event({ commits: b4a.alloc(3) }), 'event.commits'],
        ['public not array', event({ public: 'x' }), 'event.public'],
        ['bad type', event({ public: [record({ type: 'NoSlash' })] }), 'Invalid record type'],
        ['refs not array', event({ public: [record({ refs: 'x' })] }), 'record.refs'],
        ['bad record ref', event({ public: [record({ refs: [{}] })] }), 'record.refs[0]'],
        ['body not bytes', event({ public: [record({ body: 'x' })] }), 'record.body'],
        ['oversized body', event({ public: [record({ body: b4a.alloc(MAX_RECORD_BODY_BYTES + 1) })] }), 'exceeds']
    ])('rejects %s', (_name, input, message) => {
        expect(() => encodeEvent(input)).toThrow(message);
    });

    it('caps total public bytes per event', () => {
        const big = record({ body: b4a.alloc(MAX_RECORD_BODY_BYTES) });
        const records = Array(9).fill(big);
        expect(publicRecordsSize(records)).toBeGreaterThan(MAX_EVENT_PUBLIC_BYTES);
        expect(() => encodeEvent(event({ public: records }))).toThrow('event.public exceeds');
    });

    it('validates refs and type names', () => {
        expect(() => assertRef(null)).toThrow('must be a Ref');
        expect(isValidType('consensus/checkpoint.sig')).toBe(true);
        expect(isValidType('prana-vote/1')).toBe(true);
        expect(isValidType('a/b/c')).toBe(false);
        expect(isValidType(`a/${'b'.repeat(200)}`)).toBe(false);
    });
});

describe('wire format', () => {
    const rec = (type, body, refs = []) => ({ type, ts: 1700000000000, refs, body });
    const longRef = { cell: bytes(1), index: 2 ** 40, hash: bytes(2) };
    const full = () => ({
        v: 1,
        ts: 1700000000001,
        prev: bytes(3),
        otherParent: longRef,
        commits: bytes(4),
        public: [
            rec('test/opaque', b4a.from('body'), [longRef]),
            rec('test/empty', b4a.alloc(0)),
            rec(RECORD_TYPES.KEY_ADD, encodeBody(RECORD_TYPES.KEY_ADD, { purpose: 'sign', publicKey: bytes(5), contextVersion: 2 })),
            rec(RECORD_TYPES.KEY_REVOKE, encodeBody(RECORD_TYPES.KEY_REVOKE, { publicKey: bytes(6), reason: 'rotated' })),
            rec(RECORD_TYPES.KEY_REVOKE, encodeBody(RECORD_TYPES.KEY_REVOKE, { publicKey: bytes(7), reason: null }))
        ]
    });

    it('matches the golden bytes for a full event', () => {
        const block = encodeEvent(full());
        expect(b4a.toString(block, 'hex')).toBe('01ff0168e5cf8b0100000703030303030303030303030303030303030303030303030303030303030303030101010101010101010101010101010101010101010101010101010101010101ff000000000001000002020202020202020202020202020202020202020202020202020202020202020404040404040404040404040404040404040404040404040404040404040404050b746573742f6f7061717565ff0068e5cf8b010000010101010101010101010101010101010101010101010101010101010101010101ff0000000000010000020202020202020202020202020202020202020202020202020202020202020204626f64790a746573742f656d707479ff0068e5cf8b01000000000f6e75636c6575732f6b65792e616464ff0068e5cf8b0100000026047369676e050505050505050505050505050505050505050505050505050505050505050502126e75636c6575732f6b65792e7265766f6b65ff0068e5cf8b010000002906060606060606060606060606060606060606060606060606060606060606060107726f7461746564126e75636c6575732f6b65792e7265766f6b65ff0068e5cf8b0100000021070707070707070707070707070707070707070707070707070707070707070700');
        expect(decodeEvent(block)).toEqual(full());
        expect(b4a.toString(hashEvent(bytes(1), 2 ** 40, block), 'hex')).toBe('6b5b7e7ddaa91eec52cac2cbb6edd3ad5203e93f73eeead4d8309ed19732964c');
    });

    it('matches the golden bytes for genesis', () => {
        const genesis = event({
            ts: 1,
            public: [{
                type: RECORD_TYPES.GENESIS,
                ts: 1700000000000,
                refs: [],
                body: encodeBody(RECORD_TYPES.GENESIS, { protocol: PROTOCOL, created: 1 })
            }]
        });
        expect(b4a.toString(encodeEvent(genesis), 'hex')).toBe('010100010f6e75636c6575732f67656e65736973ff0068e5cf8b010000000c0a63656c6c756c65722f3101');
    });
});

describe('integer range', () => {
    it.each([2 ** 32 - 1, 2 ** 32, 2 ** 40, Number.MAX_SAFE_INTEGER])('round-trips index and ts %d', (value) => {
        const input = event({ ts: value, otherParent: { ...ref, index: value } });
        const decoded = decodeEvent(encodeEvent(input));
        expect(decoded.ts).toBe(value);
        expect(decoded.otherParent.index).toBe(value);
    });

    it('gives different hashes to indexes that differ only above 32 bits', () => {
        const block = encodeEvent(event());
        expect(b4a.equals(hashEvent(bytes(1), 1, block), hashEvent(bytes(1), 2 ** 32 + 1, block))).toBe(false);
    });

    it('rejects values beyond the safe integer range', () => {
        const unsafe = Number.MAX_SAFE_INTEGER + 1;
        expect(() => encodeEvent(event({ ts: unsafe }))).toThrow('safe integer');
        expect(() => hashEvent(bytes(1), unsafe, encodeEvent(event()))).toThrow('safe integer');
        const block = b4a.from('01ff' + '0000000000002000' + '0000', 'hex');
        expect(() => decodeEvent(block)).toThrow(EventFormatError);
    });
});

describe('hashEvent', () => {
    const block = encodeEvent(event());

    it('pins the hash definition', () => {
        expect(b4a.toString(hashEvent(bytes(1), 0, block), 'hex')).toMatchSnapshot();
    });

    it('binds the cell, the index and the block', () => {
        const base = b4a.toString(hashEvent(bytes(1), 0, block), 'hex');
        expect(b4a.toString(hashEvent(bytes(2), 0, block), 'hex')).not.toBe(base);
        expect(b4a.toString(hashEvent(bytes(1), 1, block), 'hex')).not.toBe(base);
        expect(b4a.toString(hashEvent(bytes(1), 0, encodeEvent(event({ ts: 1 }))), 'hex')).not.toBe(base);
    });

    it('rejects a bad cell or index', () => {
        expect(() => hashEvent(b4a.alloc(3), 0, block)).toThrow('cell');
        expect(() => hashEvent(bytes(1), -1, block)).toThrow('index');
    });
});

describe('record bodies', () => {
    it.each([
        [RECORD_TYPES.GENESIS, { protocol: PROTOCOL, created: 1000 }],
        [RECORD_TYPES.KEY_ADD, { purpose: 'sign', publicKey: bytes(1), contextVersion: 2 }],
        [RECORD_TYPES.KEY_REVOKE, { publicKey: bytes(1), reason: 'rotated' }],
        [RECORD_TYPES.KEY_REVOKE, { publicKey: bytes(1), reason: null }]
    ])('round-trips %s', (type, body) => {
        expect(decodeBody(type, encodeBody(type, body))).toEqual(body);
    });

    it('returns null for opaque types and refuses to encode them', () => {
        expect(decodeBody('test/thing', b4a.from('x'))).toBeNull();
        expect(() => encodeBody('test/thing', {})).toThrow('No body codec');
    });

    it('rejects malformed and non-canonical bodies', () => {
        expect(() => decodeBody(RECORD_TYPES.KEY_ADD, b4a.from([200]))).toThrow('Malformed');
        const padded = b4a.concat([
            encodeBody(RECORD_TYPES.GENESIS, { protocol: PROTOCOL, created: 1 }),
            b4a.from([0])
        ]);
        expect(() => decodeBody(RECORD_TYPES.GENESIS, padded)).toThrow('not canonically encoded');
    });
});
