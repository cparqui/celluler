import { EventFormatError } from '../errors.js';
import { isValidType } from '../events.js';
import { RecordBase } from './base.js';

function implementsMethod(RecordClass, method) {
    return RecordClass.prototype[method] !== RecordBase.prototype[method];
}

/** Maps record type names to their classes and factories. */
export class RecordRegistry {
    #entries = new Map();
    #frozen = false;

    /** @param factory (body) => an instance of RecordClass */
    register(RecordClass, factory = (body) => new RecordClass(body)) {
        if (this.#frozen) throw new Error('Record registry is frozen');
        if (!(RecordClass.prototype instanceof RecordBase)) {
            throw new Error('Record classes must extend RecordBase');
        }
        const { type, encoding } = RecordClass;
        if (!isValidType(type)) throw new Error(`Invalid record type: ${type}`);
        if (!encoding) throw new Error(`${type} must define an encoding`);
        for (const method of ['validate', 'apply']) {
            if (!implementsMethod(RecordClass, method)) {
                throw new Error(`${type} must implement ${method}()`);
            }
        }
        if (this.#entries.has(type)) {
            throw new Error(`Record type already registered: ${type}`);
        }
        this.#entries.set(type, { RecordClass, factory });
        return this;
    }

    freeze() {
        this.#frozen = true;
        return this;
    }

    has(type) {
        return this.#entries.has(type);
    }

    encode(type, body) {
        const entry = this.#entries.get(type);
        if (!entry) throw new EventFormatError(`No body codec for type: ${type}`);
        return entry.RecordClass.encode(body);
    }

    /** Strictly decodes a body; returns null for opaque (unregistered) types. */
    decode(type, bytes) {
        const entry = this.#entries.get(type);
        return entry ? entry.RecordClass.decode(bytes) : null;
    }

    /** Builds the record object for a body; returns null for opaque types. */
    create(type, bytes) {
        const entry = this.#entries.get(type);
        if (!entry) return null;
        const instance = entry.factory(entry.RecordClass.decode(bytes));
        if (!(instance instanceof entry.RecordClass)) {
            throw new Error(`Factory for ${type} returned the wrong class`);
        }
        return instance;
    }
}
