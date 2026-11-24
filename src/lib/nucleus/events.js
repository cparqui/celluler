// The journal event envelope (spec §5.2). Pure: no I/O, no service state.
//
// The wire format is defined in scripts/build-schema.js and generated into
// ./schema. Decoding is strict: a block must re-encode to exactly the same bytes,
// which rejects non-minimal integers, trailing bytes, unknown flags and invalid UTF-8.
// Integers are compact varints, valid up to Number.MAX_SAFE_INTEGER (2^53 - 1).
import b4a from 'b4a';
import c from 'compact-encoding';
import sodium from 'sodium-universal';
import { EventFormatError } from './errors.js';
import { resolveStruct } from './schema/index.js';

export const EVENT_VERSION = 1;
export const MAX_RECORD_BODY_BYTES = 1024;
export const MAX_EVENT_PUBLIC_BYTES = 8192;
export const HASH_BYTES = 32;

const TYPE_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*$/;
const MAX_TYPE_LENGTH = 128;
const HASH_DOMAIN = b4a.from('celluler/event/v1');

const eventEncoding = resolveStruct('@celluler/event');
const recordsEncoding = c.array(resolveStruct('@celluler/record'));

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

/** Gives absent optional fields and empty bodies one in-memory representation. */
function normalizeEvent(event) {
    return {
        v: event.v,
        ts: event.ts,
        prev: event.prev ?? null,
        otherParent: event.otherParent ?? null,
        commits: event.commits ?? null,
        public: event.public.map((record) => ({
            ...record,
            body: record.body ?? b4a.alloc(0)
        }))
    };
}

/** Decodes one journal block, rejecting anything but the canonical encoding. */
export function decodeEvent(block) {
    let event;
    try {
        event = normalizeEvent(c.decode(eventEncoding, block));
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
