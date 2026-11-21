import b4a from 'b4a';
import Hyperswarm from 'hyperswarm';
import { Errors } from 'moleculer';
import { getCoreInfo } from '../lib/core.utils.js';
import { RECORD_TYPES, assertRecord, decodeEvent, encodeBody, hashEvent, isValidType } from '../lib/nucleus/events.js';
import { DEFAULT_URGENT_PER_MINUTE, Journal, advanceState, verifyCoreSignature } from '../lib/nucleus/journal.js';
import { ATTESTED_PURPOSES, deriveKeyPair, openSeal, seal, signDetached, verifyDetached } from '../lib/nucleus/keys.js';
import { createJournalState } from '../lib/nucleus/replay.js';
import { openCellStore, removeEphemeral } from '../lib/nucleus/store.js';
import { parseHash, parseRef, serializeEvent, serializeKeys, serializeRef, toHex } from '../lib/nucleus/view.js';
import BaseService from './base.service.js';

const { MoleculerClientError } = Errors;

const JOURNAL_NAME = 'journal';
const DEFAULT_QUERY_LIMIT = 100;
const MAX_QUERY_LIMIT = 1000;
const DEFAULT_REPLICATE_TIMEOUT_MS = 10_000;
const REPLICATE_POLL_MS = 25;
const REPLICATE_REFRESH_MS = 500;

// `protected` actions can be called only from this node: not through the API
// gateway (which allows nucleus.*) and not from other nodes on the transporter.
const LOCAL_ONLY = { visibility: 'protected' };

const optionalCell = { type: 'string', optional: true };
const refParam = {
    type: 'object',
    props: { cell: 'any', index: { type: 'number', integer: true, min: 0 }, hash: 'any' }
};

const reject = (message, type, code = 422) => new MoleculerClientError(message, code, type);

function toBytes(value, name) {
    if (typeof value === 'string') return b4a.from(value);
    if (value instanceof Uint8Array) return b4a.from(value.buffer, value.byteOffset, value.byteLength);
    throw reject(`${name} must be bytes or a string`, 'INVALID_BYTES');
}

function parseInput(parse) {
    try {
        return parse();
    } catch (err) {
        throw reject(err.message, 'INVALID_INPUT');
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves on the core's next append, or after `ms`, always on a later event-loop turn. */
function nextAppend(core, ms) {
    return new Promise((resolve) => {
        const finish = () => {
            clearTimeout(timer);
            core.off('append', finish);
            resolve();
        };
        const timer = setTimeout(finish, ms);
        core.once('append', finish);
    });
}

export default class NucleusService extends BaseService {
    // The seed never enters `settings` or `cellConfig`: Moleculer publishes
    // service settings to other nodes and through $node.services.
    #injectedSeed;
    #clock;
    #seed = null;
    #ephemeralDirectory = null;
    #journal = null;
    #types = new Map();
    #peers = new Map();
    #topics = new Map();

    constructor(broker, cellConfig) {
        const { seed, clock, ...nucleusSettings } = cellConfig.config ?? {};
        const safeCellConfig = { ...cellConfig, config: nucleusSettings };
        super(broker, safeCellConfig);
        this.#injectedSeed = seed;
        this.#clock = clock ?? Date.now;

        this.parseServiceSchema({
            name: 'nucleus',
            settings: nucleusSettings,
            dependencies: [],
            actions: {
                // Reads
                getCellId: { handler: this.getCellId, rest: { method: 'GET', path: '/cell-id' } },
                getAttestedKeys: {
                    params: { cell: optionalCell },
                    handler: this.getAttestedKeys,
                    rest: { method: 'GET', path: '/keys' }
                },
                getHead: {
                    params: { cell: optionalCell },
                    handler: this.getHead,
                    rest: { method: 'GET', path: '/head' }
                },
                getEvent: {
                    params: { index: { type: 'number', integer: true, min: 0, convert: true }, cell: optionalCell },
                    handler: this.getEvent,
                    rest: { method: 'GET', path: '/events/:index' }
                },
                query: {
                    params: {
                        cell: optionalCell,
                        type: { type: 'string', optional: true },
                        hasOtherParent: { type: 'boolean', optional: true, convert: true },
                        from: { type: 'number', integer: true, min: 0, optional: true, convert: true },
                        to: { type: 'number', integer: true, min: 0, optional: true, convert: true },
                        limit: { type: 'number', integer: true, min: 1, max: MAX_QUERY_LIMIT, optional: true, convert: true }
                    },
                    handler: this.query,
                    rest: { method: 'GET', path: '/events' }
                },
                verifyJournal: {
                    params: { cell: optionalCell },
                    handler: this.verifyJournal,
                    rest: { method: 'GET', path: '/verify' }
                },

                // Journal writes
                registerType: {
                    ...LOCAL_ONLY,
                    params: {
                        type: 'string',
                        owner: 'string',
                        schema: { type: 'any', optional: true },
                        receipt: { type: 'boolean', optional: true }
                    },
                    handler: this.registerType
                },
                record: {
                    ...LOCAL_ONLY,
                    params: {
                        type: 'string',
                        body: 'any',
                        refs: { type: 'array', items: refParam, optional: true },
                        visibility: { type: 'enum', values: ['private', 'public'] },
                        urgent: { type: 'boolean', optional: true },
                        parent: { ...refParam, optional: true }
                    },
                    handler: this.record
                },
                sync: { ...LOCAL_ONLY, params: { peerHead: refParam }, handler: this.sync },
                rotateKey: {
                    ...LOCAL_ONLY,
                    params: {
                        purpose: { type: 'enum', values: ATTESTED_PURPOSES },
                        reason: { type: 'string', optional: true, max: 256 }
                    },
                    handler: this.rotateKey
                },

                // Peer journals
                replicate: {
                    ...LOCAL_ONLY,
                    params: {
                        cell: 'string',
                        minLength: { type: 'number', integer: true, min: 0, optional: true },
                        timeout: { type: 'number', integer: true, min: 1, optional: true }
                    },
                    handler: this.replicate
                },

                // Cell-to-cell crypto
                sign: { ...LOCAL_ONLY, params: { message: 'any' }, handler: this.sign },
                verify: {
                    ...LOCAL_ONLY,
                    params: { message: 'any', signature: 'any', cell: optionalCell },
                    handler: this.verify
                },
                seal: { ...LOCAL_ONLY, params: { message: 'any', cell: 'string' }, handler: this.seal },
                unseal: { ...LOCAL_ONLY, params: { ciphertext: 'any' }, handler: this.unseal },

                // Named non-journal cores
                bind: {
                    params: { topic: 'string', key: { type: 'string', optional: true } },
                    handler: this.bind,
                    rest: { method: 'POST', path: '/bind' }
                },
                get: {
                    params: { name: { type: 'string', optional: true }, key: { type: 'string', optional: true } },
                    handler: this.get,
                    rest: { method: 'GET', path: '/get' }
                },
                health: { handler: this.health, rest: { method: 'GET', path: '/health' } }
            },
            created: this.onCreated,
            started: this.onStarted,
            stopped: this.onStopped
        });

        this.#types.set(RECORD_TYPES.PROFILE, { type: RECORD_TYPES.PROFILE, owner: 'nucleus', receipt: false });
    }

    // Lifecycle

    onCreated() {
        this.logger.info('Nucleus service created');
    }

    async onStarted() {
        try {
            if (this.settings.storage === 'memory') {
                this.logger.warn("Memory storage: this cell's identity will not persist across restarts");
            }
            const opened = await openCellStore({ ...this.settings, seed: this.#injectedSeed });
            this.store = opened.store;
            this.#seed = opened.seed;
            this.#ephemeralDirectory = opened.ephemeralDirectory;
            this.store.on('close', () => this.logger.info('Corestore closed.'));
            this.cores = {};

            const core = this.store.get({ name: JOURNAL_NAME });
            await core.ready();
            this.#journal = await Journal.open(core, {
                clock: this.#clock,
                urgentPerMinute: this.settings.urgentPerMinute ?? DEFAULT_URGENT_PER_MINUTE
            });
            await this.#attestMissingKeys();
            this.#assertKeysMatchSeed();

            this.swarm = this.#createSwarm();
            this.#joinTopic(core.discoveryKey);

            this.logger.info('Nucleus started. Cell ID:', this.cellId);
            await this.broker.emit('nucleus.started', { cellId: this.cellId });
        } catch (err) {
            this.logger.error('Failed to start Nucleus:', err);
            await this.releaseResources();
            throw err;
        }
    }

    async onStopped() {
        const cellId = this.#journal ? this.cellId : null;
        if (this.#journal) {
            // Queued public records are in memory only until they are in an event.
            await this.#journal.flush().catch((err) => this.logger.error('Failed to flush journal:', err));
        }
        await this.broker.emit('nucleus.stopped', { cellId });
        await this.releaseResources();
    }

    async releaseResources() {
        if (this.swarm) {
            await this.swarm.destroy().catch((err) => this.logger.error('Error destroying swarm:', err));
            this.swarm = null;
        }
        for (const [name, core] of Object.entries(this.cores ?? {})) {
            await core.close().catch((err) => this.logger.error(`Error closing core ${name}:`, err));
        }
        this.cores = {};
        for (const { core } of this.#peers.values()) {
            await core.close().catch((err) => this.logger.error('Error closing peer journal:', err));
        }
        this.#peers.clear();
        this.#topics.clear();
        if (this.#journal) {
            await this.#journal.core.close().catch((err) => this.logger.error('Error closing journal:', err));
            this.#journal = null;
        }
        if (this.store) {
            await this.store.close().catch((err) => this.logger.error('Error closing store:', err));
            this.store = null;
        }
        await removeEphemeral(this.#ephemeralDirectory);
        this.#ephemeralDirectory = null;
        this.#seed = null;
    }

    get cellId() {
        return toHex(this.#requireJournal().cell);
    }

    // Reads

    async getCellId() {
        return this.cellId;
    }

    async getAttestedKeys(ctx) {
        return serializeKeys((await this.#stateOf(ctx.params.cell)).keys);
    }

    async getHead(ctx) {
        const state = await this.#stateOf(ctx.params.cell);
        if (state.length === 0) return null;
        return serializeRef({ cell: state.cell, index: state.length - 1, hash: state.head });
    }

    async getEvent(ctx) {
        const { index, cell } = ctx.params;
        const core = this.#coreOf(cell);
        if (index >= core.length) throw reject(`Event ${index} does not exist`, 'EVENT_NOT_FOUND', 404);
        return this.#readEvent(core, index);
    }

    /**
     * Scans events in [from, to) and returns those containing a record of `type`
     * and/or having an otherParent. `nextIndex` resumes the scan, or is null at the end.
     */
    async query(ctx) {
        const { cell, type, hasOtherParent, from = 0, to, limit = DEFAULT_QUERY_LIMIT } = ctx.params;
        const core = this.#coreOf(cell);
        const end = Math.min(to ?? core.length, core.length);
        const events = [];
        let index = from;
        for (; index < end && events.length < limit; index++) {
            const event = await this.#readEvent(core, index);
            if (type && !event.public.some((record) => record.type === type)) continue;
            if (hasOtherParent !== undefined && !!event.otherParent !== hasOtherParent) continue;
            events.push(event);
        }
        return { events, nextIndex: index < end ? index : null };
    }

    /**
     * Replays the locally held prefix of a journal from block 0. A peer's copy can
     * know a newer length before it has those blocks: then `complete` is false,
     * `verifiedLength` says how far replay got, and `signature` is null (unchecked).
     * Never throws for a bad journal.
     */
    async verifyJournal(ctx) {
        const core = this.#coreOf(ctx.params.cell);
        const report = {
            cell: toHex(core.key),
            valid: false,
            complete: false,
            length: core.length,
            verifiedLength: 0,
            signature: null,
            head: null,
            keys: null,
            error: null
        };
        try {
            const state = await advanceState(createJournalState(core.key), core);
            if (state.length === 0) throw new Error('journal is empty');
            report.verifiedLength = state.length;
            report.complete = state.length === core.length;
            report.head = toHex(state.head);
            report.keys = serializeKeys(state.keys);
            if (report.complete) {
                report.signature = await verifyCoreSignature(core);
                if (report.signature === false) throw new Error('invalid journal signature');
            }
            report.valid = true;
        } catch (err) {
            report.error = err.message;
        }
        return report;
    }

    // Journal writes

    registerType(ctx) {
        const { type, owner, schema = null, receipt = false } = ctx.params;
        if (!isValidType(type)) throw reject(`Invalid type name: ${type}`, 'INVALID_TYPE');
        if (type.startsWith('nucleus/')) throw reject('The nucleus/ namespace is reserved', 'RESERVED_TYPE', 403);
        const existing = this.#types.get(type);
        if (existing && existing.owner !== owner) {
            throw reject(`Type ${type} is owned by ${existing.owner}`, 'TYPE_CONFLICT', 409);
        }
        this.#types.set(type, { type, owner, schema, receipt });
        return { type, owner };
    }

    async record(ctx) {
        const journal = this.#requireJournal();
        const { type, body, refs = [], visibility, urgent = false, parent } = ctx.params;
        if (visibility === 'private') {
            throw reject('Private records need the private store, which is not implemented yet', 'NOT_IMPLEMENTED', 501);
        }
        const registered = this.#types.get(type);
        if (!registered) throw reject(`Unregistered record type: ${type}`, 'UNREGISTERED_TYPE');
        if (parent && !registered.receipt) {
            throw reject(`Type ${type} is not a receipt type and cannot set parent`, 'INVALID_PARENT');
        }

        const record = parseInput(() => {
            const parsed = {
                type,
                ts: journal.now(),
                refs: refs.map((ref, i) => parseRef(ref, `refs[${i}]`)),
                body: toBytes(body, 'body')
            };
            assertRecord(parsed);
            return parsed;
        });

        let otherParent = null;
        let verified = null;
        if (parent) {
            otherParent = parseInput(() => parseRef(parent, 'parent'));
            verified = await this.#checkPeerRef(otherParent);
        }
        const immediate = !!parent || (urgent && journal.takeUrgentSlot());
        const { seq, event } = await journal.write([record], { immediate, otherParent });
        return {
            seq,
            event: event && { index: event.index, hash: toHex(event.hash) },
            rateLimited: urgent && !immediate,
            ...(parent ? { verified } : {})
        };
    }

    /** Appends a sync event whose otherParent is a peer's event, with any pending records. */
    async sync(ctx) {
        const journal = this.#requireJournal();
        const otherParent = parseInput(() => parseRef(ctx.params.peerHead, 'peerHead'));
        const verified = await this.#checkPeerRef(otherParent);
        const { event } = await journal.write([], { immediate: true, otherParent });
        return { index: event.index, hash: toHex(event.hash), verified };
    }

    /**
     * Revokes a purpose's key and attests its successor in one event. This limits
     * a leaked derived key; it does not help if the root seed itself is compromised.
     */
    async rotateKey(ctx) {
        const journal = this.#requireJournal();
        const { purpose, reason = null } = ctx.params;
        const current = journal.state.keys[purpose];
        if (!current) throw reject(`No attested ${purpose} key`, 'NO_ATTESTED_KEY');

        const contextVersion = journal.state.highestVersion[purpose] + 1;
        const { publicKey } = deriveKeyPair(this.#seed, purpose, contextVersion);
        const ts = journal.now();
        const records = [
            {
                type: RECORD_TYPES.KEY_REVOKE,
                ts,
                refs: [],
                body: encodeBody(RECORD_TYPES.KEY_REVOKE, { publicKey: current.publicKey, reason })
            },
            {
                type: RECORD_TYPES.KEY_ADD,
                ts,
                refs: [],
                body: encodeBody(RECORD_TYPES.KEY_ADD, { purpose, publicKey, contextVersion })
            }
        ];
        const { event } = await journal.write(records, { immediate: true });
        if (purpose === 'swarm') await this.#replaceSwarm();
        return { purpose, publicKey: toHex(publicKey), contextVersion, index: event.index, hash: toHex(event.hash) };
    }

    // Peer journals

    /** Downloads and verifies a peer's journal, waiting for at least `minLength` blocks. */
    async replicate(ctx) {
        const journal = this.#requireJournal();
        const { cell, minLength = 1, timeout = DEFAULT_REPLICATE_TIMEOUT_MS } = ctx.params;
        const key = parseInput(() => parseHash(cell, 'cell'));
        if (b4a.equals(key, journal.cell)) throw reject('A cell cannot replicate its own journal', 'INVALID_INPUT');

        const peer = await this.#openPeer(key);
        const discovery = this.#joinTopic(peer.core.discoveryKey);
        const done = peer.core.findingPeers();
        await this.swarm.flush();
        done();

        const deadline = Date.now() + timeout;
        let nextRefresh = Date.now() + REPLICATE_REFRESH_MS;
        while (peer.core.length < minLength) {
            if (Date.now() >= deadline) {
                throw reject(`Timed out replicating journal ${cell}`, 'REPLICATION_TIMEOUT', 504);
            }
            await Promise.race([peer.core.update({ wait: true }), sleep(REPLICATE_POLL_MS)]);
            // update() can settle without yielding, so always give network I/O a turn.
            await nextAppend(peer.core, REPLICATE_POLL_MS);
            if (peer.core.length < minLength && peer.core.peers.length === 0 && Date.now() >= nextRefresh) {
                nextRefresh = Date.now() + REPLICATE_REFRESH_MS;
                await discovery.refresh({ client: true, server: true });
            }
        }

        let state;
        let signature;
        do {
            if (Date.now() >= deadline) {
                throw reject(`Timed out replicating journal ${cell}`, 'REPLICATION_TIMEOUT', 504);
            }
            const remaining = Math.max(deadline - Date.now(), 1);
            state = await advanceState(peer.state, peer.core, { wait: true, timeout: remaining }).catch((err) => {
                if (err.name !== 'JournalError') {
                    throw reject(`Timed out replicating journal ${cell}: ${err.message}`, 'REPLICATION_TIMEOUT', 504);
                }
                throw reject(`Invalid journal ${cell}: ${err.message}`, 'INVALID_JOURNAL');
            });
            // null means the peer appended again before the new head was downloaded.
            signature = await verifyCoreSignature(peer.core);
        } while (signature === null);
        if (!signature) throw reject(`Invalid journal signature for ${cell}`, 'INVALID_JOURNAL');
        peer.state = state;
        return { cell, length: state.length, head: await this.getHead({ params: { cell } }) };
    }

    // Cell-to-cell crypto

    sign(ctx) {
        const message = parseInput(() => toBytes(ctx.params.message, 'message'));
        return signDetached(message, this.#currentKeyPair('sign').secretKey);
    }

    /** Verifies against the cell's currently attested signing key; revoked keys fail. */
    async verify(ctx) {
        const { message, signature, cell } = ctx.params;
        const key = (await this.#stateOf(cell)).keys.sign;
        if (!key) return false;
        return verifyDetached(parseInput(() => toBytes(message, 'message')), signature, key.publicKey);
    }

    /** Seals a message to a cell's currently attested encryption key. */
    async seal(ctx) {
        const { message, cell } = ctx.params;
        const key = (await this.#stateOf(cell)).keys.box;
        if (!key) throw reject(`Cell ${cell} has no attested encryption key`, 'NO_ATTESTED_KEY');
        return seal(parseInput(() => toBytes(message, 'message')), key.publicKey);
    }

    /** Tries the current key, then retired ones, so boxes sealed before a rotation stay readable. */
    unseal(ctx) {
        const current = this.#currentKeyPair('box');
        for (let version = this.#journal.state.highestVersion.box; version >= 1; version--) {
            const keyPair = version === this.#journal.state.keys.box.contextVersion ? current : deriveKeyPair(this.#seed, 'box', version);
            const plaintext = openSeal(ctx.params.ciphertext, keyPair);
            if (plaintext) return plaintext;
        }
        throw reject('Could not open sealed box', 'UNSEAL_FAILED');
    }

    // Named non-journal cores

    async bind(ctx) {
        const { topic, key } = ctx.params;
        if (!this.store) throw new Error('Store not initialized');
        if (topic === JOURNAL_NAME) throw reject('The journal cannot be bound', 'RESERVED_NAME', 403);

        const core = await this.getCore(topic);
        if (key && b4a.toString(core.discoveryKey, 'hex') !== key) {
            throw new Error(`Discovery key mismatch for topic ${topic}`);
        }
        const foundPeers = core.findingPeers();
        this.#joinTopic(core.discoveryKey);
        await this.swarm.flush();
        foundPeers();
        return { success: true, topic, core: getCoreInfo(core) };
    }

    /** Returns core metadata only, so it cannot be used to write to any core. */
    async get(ctx) {
        const { name, key } = ctx.params;
        if (!this.store) throw new Error('Store not initialized');
        if (key) {
            const bytes = parseInput(() => parseHash(key, 'key'));
            if (b4a.equals(bytes, this.#requireJournal().cell)) {
                return { name: JOURNAL_NAME, core: getCoreInfo(this.#journal.core) };
            }
            return { name: name ?? key, core: getCoreInfo(await this.getCore(key, bytes)) };
        }
        if (!name || name === JOURNAL_NAME) {
            return { name: JOURNAL_NAME, core: getCoreInfo(this.#requireJournal().core) };
        }
        return { name, core: getCoreInfo(await this.getCore(name)) };
    }

    async health() {
        const services = {
            store: this.store ? 'healthy' : 'unavailable',
            swarm: this.swarm ? 'healthy' : 'unavailable',
            journal: this.#journal ? 'healthy' : 'unavailable'
        };
        return {
            status: Object.values(services).every((status) => status === 'healthy') ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            cellId: this.#journal ? this.cellId : null,
            services,
            metrics: {
                coresCount: Object.keys(this.cores ?? {}).length,
                peerJournals: this.#peers.size,
                journalLength: this.#journal ? this.#journal.core.length : 0,
                pendingRecords: this.#journal ? this.#journal.pendingCount : 0
            }
        };
    }

    async getCore(name, key = undefined, valueEncoding = 'json') {
        if (!this.store) throw new Error('Store not initialized');
        if (this.cores[name]) return this.cores[name];
        const core = this.store.get(key ? { key, valueEncoding } : { name, valueEncoding });
        await core.ready();
        this.cores[name] = core;
        return core;
    }

    // Internals

    #requireJournal() {
        if (!this.#journal) throw reject('Nucleus is not started', 'NOT_STARTED', 503);
        return this.#journal;
    }

    #createSwarm() {
        const swarm = new Hyperswarm({
            keyPair: this.#currentKeyPair('swarm'),
            ...(this.settings.dht?.bootstrap ? { bootstrap: this.settings.dht.bootstrap } : {})
        });
        swarm.on('connection', (conn) => {
            conn.on('error', (err) => this.logger.debug('Swarm connection error:', err.message));
            if (this.store) this.store.replicate(conn);
        });
        swarm.on('error', (err) => this.logger.error('Hyperswarm error:', err));
        return swarm;
    }

    /** Moves to a swarm using the newly attested key and rejoins every topic. */
    async #replaceSwarm() {
        const previous = this.swarm;
        const topics = [...this.#topics.values()].map(({ discoveryKey }) => discoveryKey);
        this.#topics.clear();
        this.swarm = this.#createSwarm();
        topics.forEach((discoveryKey) => this.#joinTopic(discoveryKey));
        await previous.destroy();
    }

    #joinTopic(discoveryKey) {
        const id = toHex(discoveryKey);
        const known = this.#topics.get(id);
        if (known) return known.discovery;
        const discovery = this.swarm.join(discoveryKey);
        this.#topics.set(id, { discoveryKey, discovery });
        return discovery;
    }

    #currentKeyPair(purpose) {
        const key = this.#requireJournal().state.keys[purpose];
        if (!key) throw reject(`No attested ${purpose} key`, 'NO_ATTESTED_KEY');
        return deriveKeyPair(this.#seed, purpose, key.contextVersion);
    }

    async #attestMissingKeys() {
        const state = this.#journal.state;
        const records = ATTESTED_PURPOSES.filter((purpose) => !state.keys[purpose]).map((purpose) => {
            const contextVersion = state.highestVersion[purpose] + 1;
            const { publicKey } = deriveKeyPair(this.#seed, purpose, contextVersion);
            return {
                type: RECORD_TYPES.KEY_ADD,
                ts: this.#journal.now(),
                refs: [],
                body: encodeBody(RECORD_TYPES.KEY_ADD, { purpose, publicKey, contextVersion })
            };
        });
        if (records.length > 0) await this.#journal.write(records, { immediate: true });
    }

    #assertKeysMatchSeed() {
        for (const purpose of ATTESTED_PURPOSES) {
            const key = this.#journal.state.keys[purpose];
            const { publicKey } = deriveKeyPair(this.#seed, purpose, key.contextVersion);
            if (!b4a.equals(publicKey, key.publicKey)) {
                throw new Error(`Attested ${purpose} key does not match the root seed`);
            }
        }
    }

    #coreOf(cell) {
        const journal = this.#requireJournal();
        if (cell === undefined || cell === toHex(journal.cell)) return journal.core;
        const peer = this.#peers.get(cell);
        if (!peer) throw reject(`Journal ${cell} is not replicated`, 'JOURNAL_NOT_AVAILABLE', 404);
        return peer.core;
    }

    async #stateOf(cell) {
        const journal = this.#requireJournal();
        if (cell === undefined || cell === toHex(journal.cell)) return journal.state;
        const peer = this.#peers.get(cell);
        if (!peer) throw reject(`Journal ${cell} is not replicated`, 'JOURNAL_NOT_AVAILABLE', 404);
        peer.state = await advanceState(peer.state, peer.core).catch((err) => {
            throw reject(`Invalid journal ${cell}: ${err.message}`, 'INVALID_JOURNAL');
        });
        return peer.state;
    }

    async #readEvent(core, index) {
        const block = await core.get(index, { wait: false });
        if (!block) throw reject(`Event ${index} is not available locally`, 'EVENT_NOT_AVAILABLE', 404);
        return serializeEvent(index, hashEvent(core.key, index, block), decodeEvent(block));
    }

    async #openPeer(key) {
        const id = toHex(key);
        if (!this.#peers.has(id)) {
            const core = this.store.get({ key });
            await core.ready();
            this.#peers.set(id, { core, state: createJournalState(key) });
        }
        return this.#peers.get(id);
    }

    /**
     * Rejects a reference to this cell, or one that contradicts the local copy of
     * the peer's journal. Returns whether the hash could be checked locally.
     */
    async #checkPeerRef(ref) {
        if (b4a.equals(ref.cell, this.#journal.cell)) {
            throw reject('otherParent must reference another cell', 'INVALID_REF');
        }
        const peer = this.#peers.get(toHex(ref.cell));
        if (!peer || ref.index >= peer.core.length) return false;
        const block = await peer.core.get(ref.index, { wait: false });
        if (!block) return false;
        if (!b4a.equals(hashEvent(ref.cell, ref.index, block), ref.hash)) {
            throw reject(`Ref hash does not match event ${ref.index} of the peer journal`, 'REF_HASH_MISMATCH');
        }
        return true;
    }
}
