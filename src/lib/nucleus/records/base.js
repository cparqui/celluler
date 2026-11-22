import b4a from 'b4a';
import c from 'compact-encoding';
import { EventFormatError } from '../errors.js';

/**
 * A record type whose body the Nucleus understands and whose rules affect journal
 * validity. Subclasses set `static type` and `static encoding`, and implement
 * `validate` and `apply`.
 */
export class RecordBase {
    static type = null;
    static encoding = null;

    constructor(body) {
        this.body = body;
    }

    static encode(body) {
        return c.encode(this.encoding, body);
    }

    /** Gives optional fields one in-memory representation after decoding. */
    static normalize(body) {
        return body;
    }

    /** Decodes a body, rejecting anything but its canonical encoding. */
    static decode(bytes) {
        let body;
        try {
            body = this.normalize(c.decode(this.encoding, bytes));
        } catch (err) {
            throw new EventFormatError(`Malformed ${this.type} body: ${err.message}`);
        }
        if (!b4a.equals(c.encode(this.encoding, body), bytes)) {
            throw new EventFormatError(`${this.type} body is not canonically encoded`);
        }
        return body;
    }

    /** Throws JournalError if this record is invalid at this point in the journal. */
    validate() {
        throw new Error(`${this.constructor.name} must implement validate()`);
    }

    /** Applies this already validated record to the replay state. */
    apply() {
        throw new Error(`${this.constructor.name} must implement apply()`);
    }
}
