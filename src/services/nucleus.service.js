import BaseService from './base.service.js'
import b4a from 'b4a'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import RAM from 'random-access-memory'
import _ from "lodash";
import { Service } from "moleculer";
import { getCoreInfo } from '../lib/core.utils.js';

// Parameter validation objects
const BindParams = {
    topic: "string",
    key: {
        type: "string",
        optional: true
    }
};

const GetParams = {
    name: {
        type: "string",
        optional: true
    },
    key: {
        type: "string",
        optional: true
    }
};

const WriteParams = {
    data: "any",
    name: {
        type: "string",
        optional: true
    }
};

export default class NucleusService extends BaseService {
    constructor(broker, cellConfig) {
        super(broker, cellConfig);
        
        this.parseServiceSchema({
            name: "nucleus",
            settings: cellConfig.config,
            dependencies: [],
            actions: {
                bind: {
                    params: BindParams,
                    handler: this.bind
                },
                get: {
                    params: GetParams,
                    handler: this.get
                },
                write: {
                    params: WriteParams,
                    handler: this.write
                }
            },
            created: this.onCreated,
            started: this.onStarted,
            stopped: this.onStopped,
        });
    }

    // Lifecycle events
    onCreated() {
        this.logger.info("Nucleus service created");
        
        try {
            // Initialize corestore based on storage type
            this.logger.debug("Initializing Corestore with storage type:", this.settings.storage);
            if (this.settings.storage === 'file') {
                if (!this.settings.path) {
                    throw new Error('Path must be specified when using file storage');
                }
                this.logger.debug("Initializing Corestore with file storage at:", this.settings.path);
                this.store = new Corestore(this.settings.path);
            } else if (this.settings.storage === 'memory') {
                this.logger.debug("Initializing Corestore with memory storage");
                this.store = new Corestore((filename) => new RAM());
            } else {
                throw new Error(`Invalid storage type: ${this.settings.storage}`);
            }
            
            this.cores = {};
            
            // Initialize hyperswarm
            this.logger.debug("Initializing Hyperswarm");
            this.swarm = new Hyperswarm();
            this.swarm.on('connection', (conn) => {
                this.logger.debug("New Hyperswarm connection established");
                this.store.replicate(conn);
            });
            this.swarm.on('error', (err) => this.logger.error(err, 'Hyperswarm error'));
        } catch (err) {
            this.logger.error("Failed to initialize Corestore:", err);
            this.logger.warn("Service will start without storage capabilities");
            this.store = null;
            this.cores = {};
        }
    }

    async onStarted() {
        this.logger.info("Nucleus service started");
        
        try {
            // Initialize journal core
            this.logger.debug("Initializing journal core");
            this.journal = this.store.get({ name: 'journal', valueEncoding: 'json' });
            this.cores['journal'] = this.journal;
            await this.journal.ready();
            this.logger.info("Journal ready:", getCoreInfo(this.journal, 'journal'));
            
            // Join the journal topic by default
            this.logger.debug("Joining journal topic");
            await this.swarm.join(this.journal.discoveryKey);
        } catch (err) {
            this.logger.error("Failed to initialize journal core:", err);
            this.logger.warn("Service will continue without journal capabilities");
            this.journal = null;
        }
    }

    async onStopped() {
        this.logger.info("Nucleus service stopping");
        
        // Close all cores
        for (const [name, core] of Object.entries(this.cores)) {
            try {
                this.logger.info(`Closing core: ${name}`);
                await core.close();
                this.logger.info(`Closed core: ${name}`);
            } catch (err) {
                this.logger.error(`Error closing core ${name}:`, err);
            }
        }

        // Close swarm
        if (this.swarm) {
            try {
                this.logger.info("Destroying swarm");
                await this.swarm.destroy();
                this.logger.info("Closed swarm");
            } catch (err) {
                this.logger.error("Error closing swarm:", err);
            }
        }

        // Close store
        if (this.store) {
            try {
                this.logger.info("Closing store");
                await this.store.close();
                this.logger.info("Closed store");
            } catch (err) {
                this.logger.error("Error closing store:", err);
            }
        }
    }

    // Action handlers
    async bind(ctx) {
        const { topic, key } = ctx.params;
        
        try {
            // No key provided, create new core with topic name
            let core = topic in this.cores ? this.cores[topic] : await this.getCore(topic);

            // Key provided, verify it matches stored core
            if (key && b4a.toString(core.discoveryKey, 'hex') !== key) {
                throw new Error(`Discovery key mismatch for topic ${topic}`);
            }
            
            const foundPeers = core.findingPeers()
            this.swarm.join(core.discoveryKey);
            this.swarm.flush().then(() => foundPeers());

            return { 
                success: true,
                topic: topic,
                core: getCoreInfo(core)
            };
        } catch (err) {
            this.logger.error(err, "Failed to bind to swarm topic:", topic);
            throw err;
        }
    }

    async get(ctx) {
        let { name, key } = ctx.params;
        if (_.isUndefined(name)) {
            name = 'journal';
        }

        try {
            const core = await this.getCore(name, key);
            return {
                name,
                core: getCoreInfo(core)
            };
        } catch (err) {
            this.logger.error(err, "Failed to get core:", name, key);
            throw err;
        }
    }

    async write(ctx) {
        const { data, name } = ctx.params;
        
        try {
            // Use journal if no name provided
            const core = name ? await this.getCore(name) : await this.getJournal();

            // Write the data
            await core.append(JSON.stringify(data));

            return {
                success: true,
                name: name || 'journal',
                core: getCoreInfo(core)
            };
        } catch (err) {
            this.logger.error("Failed to write to core:", err);
            throw err;
        }
    }

    // Helper methods
    async getCore(name, key = undefined, valueEncoding = 'json') {
        // Get or create the named core
        const core = key? this.store.get({key, valueEncoding}): this.store.get({name, valueEncoding});
        await core.ready();
        this.logger.info("Hypercore ready:", getCoreInfo(core, name));
        this.cores[name] = core;

        return core;
    }

    async getJournal() {
        return this.getCore('journal');
    }
} 