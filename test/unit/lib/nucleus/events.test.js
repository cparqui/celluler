import b4a from 'b4a';
import {
    EventFormatError,
    MAX_EVENT_PUBLIC_BYTES,
    MAX_RECORD_BODY_BYTES,
    PROTOCOL,
    RECORD_TYPES,
    assertRef,
    decodeBody,
    decodeEvent,
    encodeBody,
    encodeEvent,
    hashEvent,
    isValidType,
    publicRecordsSize
} from '../../../../src/lib/nucleus/events.js';

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
        [RECORD_TYPES.KEY_REVOKE, { publicKey: bytes(1), reason: '' }],
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
        const padded = b4a.concat([encodeBody(RECORD_TYPES.GENESIS, { protocol: PROTOCOL, created: 1 }), b4a.from([0])]);
        expect(() => decodeBody(RECORD_TYPES.GENESIS, padded)).toThrow('not canonically encoded');
    });
});
