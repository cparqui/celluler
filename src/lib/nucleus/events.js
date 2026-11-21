// The journal event format (spec §5.2). Pure: no I/O, no service state.
//
// Event layout, in order, using compact-encoding:
//   v            uint     format version, = 1
//   ts           uint     creator's claimed time, ms
//   flags        uint     bit 0: prev, bit 1: otherParent, bit 2: commits
//   prev         fixed32  hash of event i - 1 (absent only at genesis)
//   otherParent  Ref      { cell: fixed32, index: uint, hash: fixed32 }
//   commits      fixed32
//   public       array of Record { type: string, ts: uint, refs: Ref[], body: buffer }
//
// Decoding is strict: a block must re-encode to exactly the same bytes, which
// rejects non-minimal integers, trailing bytes, unknown flags and invalid UTF-8.
import b4a from 'b4a';
import c from 'compact-encoding';
import sodium from 'sodium-universal';

export const EVENT_VERSION = 1;
export const PROTOCOL = 'celluler/1';
export const MAX_RECORD_BODY_BYTES = 1024;
export const MAX_EVENT_PUBLIC_BYTES = 8192;
export const HASH_BYTES = 32;

export const RECORD_TYPES = Object.freeze({
    GENESIS: 'nucleus/genesis',
    KEY_ADD: 'nucleus/key.add',
    KEY_REVOKE: 'nucleus/key.revoke',
    PROFILE: 'nucleus/profile'
});

const TYPE_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*$/;
const MAX_TYPE_LENGTH = 128;
const HASH_DOMAIN = b4a.from('celluler/event/v1');

const FLAG_PREV = 1;
const FLAG_OTHER_PARENT = 2;
const FLAG_COMMITS = 4;

export class EventFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = 'EventFormatError';
    }
}

const refEncoding = {
    preencode(state, ref) {
        c.fixed32.preencode(state, ref.cell);
        c.uint.preencode(state, ref.index);
        c.fixed32.preencode(state, ref.hash);
    },
    encode(state, ref) {
        c.fixed32.encode(state, ref.cell);
        c.uint.encode(state, ref.index);
        c.fixed32.encode(state, ref.hash);
    },
    decode(state) {
        return { cell: c.fixed32.decode(state), index: c.uint.decode(state), hash: c.fixed32.decode(state) };
    }
};

const refsEncoding = c.array(refEncoding);

const recordEncoding = {
    preencode(state, record) {
        c.string.preencode(state, record.type);
        c.uint.preencode(state, record.ts);
        refsEncoding.preencode(state, record.refs);
        c.buffer.preencode(state, record.body);
    },
    encode(state, record) {
        c.string.encode(state, record.type);
        c.uint.encode(state, record.ts);
        refsEncoding.encode(state, record.refs);
        c.buffer.encode(state, record.body);
    },
    decode(state) {
        return {
            type: c.string.decode(state),
            ts: c.uint.decode(state),
            refs: refsEncoding.decode(state),
            body: c.buffer.decode(state) ?? b4a.alloc(0)
        };
    }
};

const recordsEncoding = c.array(recordEncoding);

function eventFlags(event) {
    return (event.prev ? FLAG_PREV : 0) | (event.otherParent ? FLAG_OTHER_PARENT : 0) | (event.commits ? FLAG_COMMITS : 0);
}

const eventEncoding = {
    preencode(state, event) {
        c.uint.preencode(state, event.v);
        c.uint.preencode(state, event.ts);
        c.uint.preencode(state, eventFlags(event));
        if (event.prev) c.fixed32.preencode(state, event.prev);
        if (event.otherParent) refEncoding.preencode(state, event.otherParent);
        if (event.commits) c.fixed32.preencode(state, event.commits);
        recordsEncoding.preencode(state, event.public);
    },
    encode(state, event) {
        c.uint.encode(state, event.v);
        c.uint.encode(state, event.ts);
        c.uint.encode(state, eventFlags(event));
        if (event.prev) c.fixed32.encode(state, event.prev);
        if (event.otherParent) refEncoding.encode(state, event.otherParent);
        if (event.commits) c.fixed32.encode(state, event.commits);
        recordsEncoding.encode(state, event.public);
    },
    decode(state) {
        const v = c.uint.decode(state);
        const ts = c.uint.decode(state);
        const flags = c.uint.decode(state);
        return {
            v,
            ts,
            prev: flags & FLAG_PREV ? c.fixed32.decode(state) : null,
            otherParent: flags & FLAG_OTHER_PARENT ? refEncoding.decode(state) : null,
            commits: flags & FLAG_COMMITS ? c.fixed32.decode(state) : null,
            public: recordsEncoding.decode(state)
        };
    }
};

function assertUint(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new EventFormatError(`${name} must be a non-negative safe integer`);
    }
}

function assertHash(value, name) {
    if (!b4a.isBuffer(value) || value.byteLength !== HASH_BYTES) {
        throw new EventFormatError(`${name} must be ${HASH_BYTES} bytes`);
    }
}

export function assertRef(ref, name = 'ref') {
    if (!ref || typeof ref !== 'object') throw new EventFormatError(`${name} must be a Ref`);
    assertHash(ref.cell, `${name}.cell`);
    assertUint(ref.index, `${name}.index`);
    assertHash(ref.hash, `${name}.hash`);
}

export function isValidType(type) {
    return typeof type === 'string' && type.length <= MAX_TYPE_LENGTH && TYPE_PATTERN.test(type);
}

export function assertRecord(record) {
    if (!isValidType(record?.type)) throw new EventFormatError(`Invalid record type: ${record?.type}`);
    assertUint(record.ts, 'record.ts');
    if (!Array.isArray(record.refs)) throw new EventFormatError('record.refs must be an array');
    record.refs.forEach((ref, i) => assertRef(ref, `record.refs[${i}]`));
    if (!b4a.isBuffer(record.body)) throw new EventFormatError('record.body must be bytes');
    if (record.body.byteLength > MAX_RECORD_BODY_BYTES) {
        throw new EventFormatError(`record.body exceeds ${MAX_RECORD_BODY_BYTES} bytes`);
    }
}

/** Encoded size of a list of public records, the quantity capped at 8 KB per event. */
export function publicRecordsSize(records) {
    return c.encode(recordsEncoding, records).byteLength;
}

export function assertEvent(event) {
    if (event?.v !== EVENT_VERSION) throw new EventFormatError(`Unsupported event version: ${event?.v}`);
    assertUint(event.ts, 'event.ts');
    if (event.prev !== null) assertHash(event.prev, 'event.prev');
    if (event.otherParent !== null) assertRef(event.otherParent, 'event.otherParent');
    if (event.commits !== null) assertHash(event.commits, 'event.commits');
    if (!Array.isArray(event.public)) throw new EventFormatError('event.public must be an array');
    event.public.forEach(assertRecord);
    if (publicRecordsSize(event.public) > MAX_EVENT_PUBLIC_BYTES) {
        throw new EventFormatError(`event.public exceeds ${MAX_EVENT_PUBLIC_BYTES} bytes`);
    }
}

export function encodeEvent(event) {
    assertEvent(event);
    return c.encode(eventEncoding, event);
}

/** Decodes one journal block, rejecting anything but the canonical encoding. */
export function decodeEvent(block) {
    let event;
    try {
        event = c.decode(eventEncoding, block);
    } catch (err) {
        throw new EventFormatError(`Malformed event: ${err.message}`);
    }
    assertEvent(event);
    if (!b4a.equals(c.encode(eventEncoding, event), block)) {
        throw new EventFormatError('Event is not canonically encoded');
    }
    return event;
}

/**
 * An event's hash, the value a `Ref.hash` points to:
 *   BLAKE2b-256("celluler/event/v1" ‖ cell ‖ index as uint64 LE ‖ block)
 * Every input before the block has a fixed length, so the framing is unambiguous.
 * Because each block contains `prev`, the hash commits to the event's whole history.
 */
export function hashEvent(cell, index, block) {
    assertHash(cell, 'cell');
    assertUint(index, 'index');
    const indexBytes = b4a.alloc(8);
    new DataView(indexBytes.buffer, indexBytes.byteOffset, 8).setBigUint64(0, BigInt(index), true);
    const out = b4a.alloc(HASH_BYTES);
    sodium.crypto_generichash_batch(out, [HASH_DOMAIN, cell, indexBytes, block]);
    return out;
}

const genesisBody = {
    preencode(state, body) {
        c.string.preencode(state, body.protocol);
        c.uint.preencode(state, body.created);
    },
    encode(state, body) {
        c.string.encode(state, body.protocol);
        c.uint.encode(state, body.created);
    },
    decode(state) {
        return { protocol: c.string.decode(state), created: c.uint.decode(state) };
    }
};

const keyAddBody = {
    preencode(state, body) {
        c.string.preencode(state, body.purpose);
        c.fixed32.preencode(state, body.publicKey);
        c.uint.preencode(state, body.contextVersion);
    },
    encode(state, body) {
        c.string.encode(state, body.purpose);
        c.fixed32.encode(state, body.publicKey);
        c.uint.encode(state, body.contextVersion);
    },
    decode(state) {
        return {
            purpose: c.string.decode(state),
            publicKey: c.fixed32.decode(state),
            contextVersion: c.uint.decode(state)
        };
    }
};

// `reason` is a flag plus a string so that "absent" and "" encode differently.
const keyRevokeBody = {
    preencode(state, body) {
        c.fixed32.preencode(state, body.publicKey);
        c.bool.preencode(state, body.reason != null);
        if (body.reason != null) c.string.preencode(state, body.reason);
    },
    encode(state, body) {
        c.fixed32.encode(state, body.publicKey);
        c.bool.encode(state, body.reason != null);
        if (body.reason != null) c.string.encode(state, body.reason);
    },
    decode(state) {
        const publicKey = c.fixed32.decode(state);
        return { publicKey, reason: c.bool.decode(state) ? c.string.decode(state) : null };
    }
};

const BODY_ENCODINGS = {
    [RECORD_TYPES.GENESIS]: genesisBody,
    [RECORD_TYPES.KEY_ADD]: keyAddBody,
    [RECORD_TYPES.KEY_REVOKE]: keyRevokeBody
};

/** Encodes the body of a Nucleus record type. Other types' bodies are opaque bytes. */
export function encodeBody(type, body) {
    const encoding = BODY_ENCODINGS[type];
    if (!encoding) throw new EventFormatError(`No body codec for type: ${type}`);
    return c.encode(encoding, body);
}

/** Strictly decodes a Nucleus record body; returns null for opaque types. */
export function decodeBody(type, bytes) {
    const encoding = BODY_ENCODINGS[type];
    if (!encoding) return null;
    let body;
    try {
        body = c.decode(encoding, bytes);
    } catch (err) {
        throw new EventFormatError(`Malformed ${type} body: ${err.message}`);
    }
    if (!b4a.equals(c.encode(encoding, body), bytes)) {
        throw new EventFormatError(`${type} body is not canonically encoded`);
    }
    return body;
}
