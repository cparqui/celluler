// The cell's journal: the only code that appends to the journal Hypercore.
import b4a from 'b4a';
import { JournalError } from './errors.js';
import { MAX_EVENT_PUBLIC_BYTES, EVENT_VERSION, encodeEvent, publicRecordsSize } from './events.js';
import { PROTOCOL, RECORD_TYPES, encodeBody } from './records/index.js';
import { applyBlock, cloneJournalState, createJournalState } from './replay.js';

export const DEFAULT_URGENT_PER_MINUTE = 6;
const MINUTE_MS = 60_000;

/** Applies any newer blocks in `core` to a copy of `state`, which is returned. */
export async function advanceState(state, core, { wait = false, timeout = 0 } = {}) {
    const next = cloneJournalState(state);
    while (next.length < core.length) {
        const block = await core.get(next.length, wait ? { timeout } : { wait: false });
        if (!block) break;
        applyBlock(next, block);
    }
    return next;
}

/**
 * Checks the journal's signed head against the single Ed25519 signer in its manifest.
 * Hypercore already verifies this on replication; this makes the check explicit.
 * It uses Hypercore's verifier and head signature, which are internal to ^11.
 * @returns {Promise<boolean | null>} null if the signed head block is not held locally.
 */
export async function verifyCoreSignature(core, signature = core.state.signature) {
    // Read these together, before any await, so a concurrent append cannot mismatch them.
    const length = core.signedLength;
    const fork = core.fork;
    const signers = core.manifest?.signers ?? [];
    if (signers.length !== 1 || core.manifest.quorum !== 1 || !signature) return false;
    if (length > 0 && !(await core.has(length - 1))) return null;
    const signable = await core.signable(length, fork);
    try {
        return core.core.verifier.verify({ length, signable: () => signable }, signature);
    } catch {
        return false;
    }
}

export class Journal {
    #core;
    #state;
    #clock;
    #urgentPerMinute;
    #pending = [];
    #urgentTimes = [];
    #tail = Promise.resolve();

    constructor(core, state, { clock = Date.now, urgentPerMinute = DEFAULT_URGENT_PER_MINUTE } = {}) {
        this.#core = core;
        this.#state = state;
        this.#clock = clock;
        this.#urgentPerMinute = urgentPerMinute;
    }

    /** Replays an existing journal, or writes genesis to an empty one. */
    static async open(core, opts = {}) {
        const state = await advanceState(createJournalState(core.key), core);
        if (state.length !== core.length) throw new JournalError('journal has missing local blocks');

        const journal = new Journal(core, state, opts);
        if (state.length === 0) {
            const created = journal.#clock();
            const body = encodeBody(RECORD_TYPES.GENESIS, {
                protocol: PROTOCOL,
                created
            });
            await journal.write([{ type: RECORD_TYPES.GENESIS, ts: created, refs: [], body }], { immediate: true });
        }
        return journal;
    }

    get core() {
        return this.#core;
    }

    get cell() {
        return this.#core.key;
    }

    get state() {
        return this.#state;
    }

    get pendingCount() {
        return this.#pending.length;
    }

    /** Consumes one urgent slot; false means the record must wait for the next event. */
    takeUrgentSlot() {
        const now = this.#clock();
        this.#urgentTimes = this.#urgentTimes.filter((time) => now - time < MINUTE_MS);
        if (this.#urgentTimes.length >= this.#urgentPerMinute) return false;
        this.#urgentTimes.push(now);
        return true;
    }

    now() {
        return this.#clock();
    }

    /**
     * Adds records, serialized with every other write. With `immediate`, they are
     * published now, together with anything pending, in one event.
     * @returns {{ seq: number, event: { index: number, hash: Buffer } | null }}
     */
    write(records, { immediate = false, otherParent = null } = {}) {
        return this.#serialize(async () => {
            const seq = this.#state.publicRecords + this.#pending.length;
            if (
                this.#pending.length > 0 &&
                publicRecordsSize([...this.#pending, ...records]) > MAX_EVENT_PUBLIC_BYTES
            ) {
                await this.#commit(this.#pending, null);
            }
            if (!immediate) {
                this.#pending.push(...records);
                return { seq, event: null };
            }
            const event = await this.#commit([...this.#pending, ...records], otherParent);
            return { seq, event };
        });
    }

    /** Publishes pending records, if any. */
    flush() {
        return this.#serialize(async () => {
            return this.#pending.length > 0 ? this.#commit(this.#pending, null) : null;
        });
    }

    async #commit(records, otherParent) {
        const state = this.#state;
        const block = encodeEvent({
            v: EVENT_VERSION,
            // Strictly increasing along the chain, even if the wall clock steps back.
            ts: state.length === 0 ? this.#clock() : Math.max(this.#clock(), state.lastTs + 1),
            prev: state.head,
            otherParent,
            commits: null,
            public: records
        });
        // Validate against a copy, so a rejected event changes nothing.
        const next = cloneJournalState(state);
        const { hash } = applyBlock(next, block);
        await this.#core.append(block);
        this.#state = next;
        this.#pending = [];
        return { index: next.length - 1, hash: b4a.from(hash) };
    }

    #serialize(task) {
        const run = this.#tail.then(task);
        this.#tail = run.catch(() => {});
        return run;
    }
}
