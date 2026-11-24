import { JournalError } from '../errors.js';
import { resolveStruct } from '../schema/index.js';
import { RecordBase } from './base.js';

export const PROTOCOL = 'celluler/1';

export class GenesisRecord extends RecordBase {
    static type = 'nucleus/genesis';
    static encoding = resolveStruct('@celluler/genesis');

    validate(state, { index }) {
        if (index !== 0) {
            throw new JournalError('nucleus/genesis is only valid in block 0', index);
        }
        if (this.body.protocol !== PROTOCOL) {
            throw new JournalError(`unsupported protocol: ${this.body.protocol}`, index);
        }
    }

    apply() {}
}
