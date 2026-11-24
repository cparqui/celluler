// Generates src/lib/nucleus/schema/ from these definitions: `npm run schema:build`.
// Hyperschema keeps the schema append-only: new optional fields bump its version,
// and incompatible edits to a published struct are refused.
import Hyperschema from 'hyperschema';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/lib/nucleus/schema');

const required = (name, type, options = {}) => ({
    name,
    type,
    required: true,
    ...options
});
const optional = (name, type) => ({ name, type, useDefault: false });

const schema = Hyperschema.from(output, { esm: true });
const celluler = schema.namespace('celluler');

// `compact` structs are not length-framed when nested, which keeps events small.
celluler.register({
    name: 'ref',
    compact: true,
    fields: [required('cell', 'fixed32'), required('index', 'uint'), required('hash', 'fixed32')]
});

celluler.register({
    name: 'record',
    compact: true,
    fields: [
        required('type', 'string'),
        required('ts', 'uint'),
        required('refs', '@celluler/ref', { array: true }),
        required('body', 'buffer')
    ]
});

celluler.register({
    name: 'event',
    compact: true,
    fields: [
        required('v', 'uint'),
        required('ts', 'uint'),
        optional('prev', 'fixed32'),
        optional('otherParent', '@celluler/ref'),
        optional('commits', 'fixed32'),
        required('public', '@celluler/record', { array: true })
    ]
});

celluler.register({
    name: 'genesis',
    compact: true,
    fields: [required('protocol', 'string'), required('created', 'uint')]
});

celluler.register({
    name: 'key-add',
    compact: true,
    fields: [required('purpose', 'string'), required('publicKey', 'fixed32'), required('contextVersion', 'uint')]
});

celluler.register({
    name: 'key-revoke',
    compact: true,
    fields: [required('publicKey', 'fixed32'), optional('reason', 'string')]
});

Hyperschema.toDisk(schema, { esm: true });
