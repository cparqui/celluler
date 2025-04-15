import b4a from 'b4a'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import _ from "lodash";
import { Service } from "moleculer";
import { getCoreInfo } from '../lib/core_utils.js';

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

// Default settings
const DEFAULT_SETTINGS = {
    // Storage settings
    storagePath: "./data",  // Path for hypercore storage
};

export default class NucleusService extends Service {
    constructor(broker, settings = {}) {
        super(broker);

        this.parseServiceSchema({
            name: "nucleus",
            version: 1,
            settings: _.defaultsDeep(settings, DEFAULT_SETTINGS),
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
            // events: {
            //     "core.ready": ctx => this.onCoreReady(ctx),
            //     "swarm.connection": ctx => this.onSwarmConnection(ctx)
            // }
            created: this.onCreated,
            started: this.onStarted,
            stopped: this.onStopped,
        });
    }

    // Lifecycle events
    onCreated() {
        this.logger.info("Nucleus service created");

        // Initialize corestore
        this.store = new Corestore(this.settings.storagePath);
        this.cores = {}
        
        // Initialize hyperswarm
        this.swarm = new Hyperswarm();
        this.swarm.on('connection', (conn) => {
            this.store.replicate(conn);
            // this.broker.emit("swarm.connection", { connection: conn });
        });
        this.swarm.on('error', (err) => this.logger.error(err, 'Hyperswarm error'));
    }

    async onStarted() {
        this.logger.info("Nucleus service started");

        // Initialize corestore
        this.store = new Corestore(this.settings.storagePath);
        this.cores = {}
        
        // Initialize journal core
        this.journal = this.store.get({ name: 'journal', valueEncoding: 'json' });
        this.cores['journal'] = this.journal
        await this.journal.ready();
        this.logger.info("Journal ready:", getCoreInfo(this.journal, 'journal'));

        // Initialize hyperswarm
        this.swarm = new Hyperswarm();
        this.swarm.on('connection', (conn) => {
            this.store.replicate(conn);
            this.broker.emit("swarm.connection", { connection: conn });
        });
        this.swarm.on('error', (err) => this.logger.error(err, 'Hyperswarm error'));
        
        // Join the journal topic by default
        await this.swarm.join(this.journal.discoveryKey);
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

    // Event handlers
    // async onCoreReady(ctx) {
    //     const { name, core } = ctx.params;
    //     this.logger.info(`Core ready: ${name}`, core);
    // }

    // async onSwarmConnection(ctx) {
    //     const { connection } = ctx.params;
    //     this.logger.info("New swarm connection established");
    // }

    // Helper methods
    async getCore(name, key = undefined, valueEncoding = 'json') {
        // Get or create the named core
        const core = key? this.store.get({key, valueEncoding}): this.store.get({name, valueEncoding});
        await core.ready();
        this.logger.info("Hypercore ready:", getCoreInfo(core, name));
        this.cores[name] = core;

        // this.broker.emit("core.ready", { 
        //     name,
        //     core: getCoreInfo(core)
        // });

        return core;
    }

    async getJournal() {
        return this.getCore('journal');
    }
} 