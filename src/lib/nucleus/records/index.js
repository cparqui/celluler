// The Nucleus protocol record types.
//
// This registry decides whether a journal is valid, so every cell must hold the
// same one. It is frozen at load and services cannot add to it: if validity
// depended on which services a cell runs, cells would disagree about the same
// journal. To add a protocol rule, define a RecordBase subclass and register it
// here. Service-owned types stay opaque bytes, interpreted by the owning service.
import { GenesisRecord, PROTOCOL } from './genesis.js';
import { KeyAddRecord, KeyRevokeRecord } from './key-records.js';
import { RecordRegistry } from './registry.js';

export { PROTOCOL };

export const RECORD_TYPES = Object.freeze({
    GENESIS: GenesisRecord.type,
    KEY_ADD: KeyAddRecord.type,
    KEY_REVOKE: KeyRevokeRecord.type,
    PROFILE: 'nucleus/profile'
});

export const nucleusRecords = new RecordRegistry()
    .register(GenesisRecord)
    .register(KeyAddRecord)
    .register(KeyRevokeRecord)
    .freeze();

export const encodeBody = (type, body) => nucleusRecords.encode(type, body);
export const decodeBody = (type, bytes) => nucleusRecords.decode(type, bytes);
