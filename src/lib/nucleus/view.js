// Converts between internal events and the JSON-safe, hex-encoded API shape.
import b4a from 'b4a';
import { assertRef, decodeBody } from './events.js';

const HEX_32 = /^[0-9a-f]{64}$/;

export const toHex = (bytes) => (bytes ? b4a.toString(bytes, 'hex') : null);

export function parseHash(value, name) {
    if (typeof value === 'string' && HEX_32.test(value)) return b4a.from(value, 'hex');
    if (b4a.isBuffer(value) && value.byteLength === 32) return value;
    throw new Error(`${name} must be 32 bytes or 64 lowercase hex characters`);
}

export function parseRef(ref, name = 'ref') {
    if (!ref || typeof ref !== 'object') throw new Error(`${name} must be a Ref`);
    const parsed = {
        cell: parseHash(ref.cell, `${name}.cell`),
        index: ref.index,
        hash: parseHash(ref.hash, `${name}.hash`)
    };
    assertRef(parsed, name);
    return parsed;
}

export function serializeRef(ref) {
    return ref ? { cell: toHex(ref.cell), index: ref.index, hash: toHex(ref.hash) } : null;
}

function hexFields(body) {
    if (!body) return null;
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, b4a.isBuffer(v) ? toHex(v) : v]));
}

export function serializeRecord(record) {
    return {
        type: record.type,
        ts: record.ts,
        refs: record.refs.map(serializeRef),
        body: toHex(record.body),
        decoded: hexFields(decodeBody(record.type, record.body))
    };
}

export function serializeEvent(index, hash, event) {
    return {
        index,
        hash: toHex(hash),
        v: event.v,
        ts: event.ts,
        prev: toHex(event.prev),
        otherParent: serializeRef(event.otherParent),
        commits: toHex(event.commits),
        public: event.public.map(serializeRecord)
    };
}

export function serializeKeys(keys) {
    return Object.fromEntries(
        Object.entries(keys).map(([purpose, key]) => [
            purpose,
            key && { publicKey: toHex(key.publicKey), contextVersion: key.contextVersion, attestedAt: key.attestedAt }
        ])
    );
}
