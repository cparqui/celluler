import { jest } from '@jest/globals';
import b4a from 'b4a';
import c from 'compact-encoding';
import { JournalError } from '../../../../src/lib/nucleus/errors.js';
import { RecordBase } from '../../../../src/lib/nucleus/records/base.js';
import { RECORD_TYPES, encodeBody, nucleusRecords } from '../../../../src/lib/nucleus/records/index.js';
import { KeyRevokeRecord } from '../../../../src/lib/nucleus/records/key-records.js';
import { RecordRegistry } from '../../../../src/lib/nucleus/records/registry.js';
import { createJournalState } from '../../../../src/lib/nucleus/replay.js';

class NoteRecord extends RecordBase {
    static type = 'test/note';
    static encoding = c.string;

    validate(state, { index }) {
        if (this.body === 'bad') throw new JournalError('bad note', index);
    }

    apply(state) {
        state.notes = [...(state.notes ?? []), this.body];
    }
}

describe('RecordBase', () => {
    it('requires subclasses to implement validate and apply', () => {
        class Partial extends RecordBase {}
        const record = new Partial({});
        expect(() => record.validate()).toThrow('Partial must implement validate()');
        expect(() => record.apply()).toThrow('Partial must implement apply()');
    });

    it('rejects malformed and non-canonical bodies', () => {
        expect(() => NoteRecord.decode(b4a.from([200]))).toThrow('Malformed test/note body');
        const padded = b4a.concat([NoteRecord.encode('x'), b4a.from([0])]);
        expect(() => NoteRecord.decode(padded)).toThrow('not canonically encoded');
    });

    it('treats an empty revoke reason as no reason', () => {
        const bytes = KeyRevokeRecord.encode({ publicKey: b4a.alloc(32, 1), reason: '' });
        expect(KeyRevokeRecord.decode(bytes).reason).toBeNull();
    });
});

describe('RecordRegistry', () => {
    it('builds a record through the default factory and runs its rules', () => {
        const registry = new RecordRegistry().register(NoteRecord);
        const record = registry.create('test/note', NoteRecord.encode('hello'));
        const state = createJournalState(b4a.alloc(32));
        expect(record).toBeInstanceOf(NoteRecord);
        record.validate(state, { index: 1 });
        record.apply(state, { index: 1 });
        expect(state.notes).toEqual(['hello']);
        expect(() => registry.create('test/note', NoteRecord.encode('bad')).validate(state, { index: 2 }))
            .toThrow('bad note');
    });

    it('uses a custom factory and checks what it returns', () => {
        const factory = jest.fn((body) => new NoteRecord(body.toUpperCase()));
        const registry = new RecordRegistry().register(NoteRecord, factory);
        expect(registry.create('test/note', NoteRecord.encode('hi')).body).toBe('HI');

        const wrong = new RecordRegistry().register(NoteRecord, () => ({}));
        expect(() => wrong.create('test/note', NoteRecord.encode('hi'))).toThrow('wrong class');
    });

    it('treats unregistered types as opaque', () => {
        const registry = new RecordRegistry();
        expect(registry.has('test/other')).toBe(false);
        expect(registry.decode('test/other', b4a.from('x'))).toBeNull();
        expect(registry.create('test/other', b4a.from('x'))).toBeNull();
        expect(() => registry.encode('test/other', {})).toThrow('No body codec');
    });

    it('rejects invalid registrations', () => {
        class NoRules extends RecordBase {
            static type = 'test/no-rules';
            static encoding = c.string;
        }
        class NoApply extends RecordBase {
            static type = 'test/no-apply';
            static encoding = c.string;
            validate() {}
        }
        class NoEncoding extends NoteRecord {
            static type = 'test/no-encoding';
            static encoding = null;
        }
        class BadType extends NoteRecord {
            static type = 'Bad';
        }
        const registry = new RecordRegistry();
        expect(() => registry.register(class {})).toThrow('must extend RecordBase');
        expect(() => registry.register(NoRules)).toThrow('must implement validate()');
        expect(() => registry.register(NoApply)).toThrow('must implement apply()');
        expect(() => registry.register(NoEncoding)).toThrow('must define an encoding');
        expect(() => registry.register(BadType)).toThrow('Invalid record type');
        registry.register(NoteRecord);
        expect(() => registry.register(NoteRecord)).toThrow('already registered');
    });

    it('keeps the protocol registry fixed, so services cannot change journal validity', () => {
        expect(() => nucleusRecords.register(NoteRecord)).toThrow('frozen');
        for (const type of [RECORD_TYPES.GENESIS, RECORD_TYPES.KEY_ADD, RECORD_TYPES.KEY_REVOKE]) {
            expect(nucleusRecords.has(type)).toBe(true);
        }
        expect(nucleusRecords.has(RECORD_TYPES.PROFILE)).toBe(false);
        expect(encodeBody(RECORD_TYPES.KEY_REVOKE, { publicKey: b4a.alloc(32), reason: null })).toHaveLength(33);
    });
});
