import BaseService from './base.service.js';
import b4a from 'b4a';
import Corestore from 'corestore';
import Hyperswarm from 'hyperswarm';
import RAM from 'random-access-memory';
import _ from 'lodash';
import { getCoreInfo, generateCellUUID, generateKeyPair } from '../lib/core.utils.js';
import crypto from 'crypto';

// Parameter validation objects
const BindParams = {
    topic: {
        type: "string",
        min: 1
    },
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
    data: {
        type: "object"
    },
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
                    handler: this.bind,
                    rest: {
                        method: "POST",
                        path: "/bind"
                    }
                },
                get: {
                    params: GetParams,
                    handler: this.get,
                    rest: {
                        method: "GET",
                        path: "/get"
                    }
                },
                write: {
                    params: WriteParams,
                    handler: this.write,
                    rest: {
                        method: "POST",
                        path: "/write"
                    }
                },
                read: {
                    params: {
                        name: {
                            type: "string",
                            min: 1
                        },
                        limit: {
                            type: "number",
                            min: 1,
                            max: 1000,
                            optional: true,
                            default: 50
                        },
                        since: {
                            type: "number",
                            optional: true
                        }
                    },
                    handler: this.read,
                    rest: {
                        method: "GET",
                        path: "/read/:name"
                    }
                },
                getUUID: {
                    handler: this.getUUID,
                    rest: {
                        method: "GET",
                        path: "/uuid"
                    }
                },
                getPublicKey: {
                    handler: this.getPublicKey,
                    rest: {
                        method: "GET",
                        path: "/public-key"
                    }
                },
                health: {
                    handler: this.health,
                    rest: {
                        method: "GET",
                        path: "/health"
                    }
                },
                encryptForCell: {
                    params: {
                        targetPublicKey: {
                            type: "string",
                            min: 100
                        },
                        message: {
                            type: "string",
                            min: 1
                        }
                    },
                    handler: this.encryptForCellAction,
                    rest: {
                        method: "POST",
                        path: "/encrypt"
                    }
                },
                decryptFromCell: {
                    params: {
                        sourcePublicKey: {
                            type: "string",
                            min: 100
                        },
                        encryptedData: {
                            type: "object"
                        }
                    },
                    handler: this.decryptFromCellAction,
                    rest: {
                        method: "POST",
                        path: "/decrypt"
                    }
                },
                signMessage: {
                    params: {
                        message: {
                            type: "string",
                            min: 1
                        }
                    },
                    handler: this.signMessageAction,
                    rest: {
                        method: "POST",
                        path: "/sign"
                    }
                }
            },
            created: this.onCreated,
            started: this.onStarted,
            stopped: this.onStopped,
        });

        this.cellUUID = null;

        // Generate key pair for the cell
        const { publicKey, privateKey } = generateKeyPair();
        this.publicKey = publicKey;
        this.privateKey = privateKey;
        this.logger.info("Generated cell key pair. Public key: \n", this.publicKey);
    }

    // Lifecycle events
    onCreated() {
        this.logger.info("Nucleus service created");
    }

    async onStarted() {
        this.logger.info("Nucleus service started");
        
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
            this.store.on('close', () => this.logger.info("Corestore closed."));
            await this.store.ready().catch((err) => this.logger.error("Failed to initialize Corestore:", err));
            this.logger.info("Corestore initialized.");
            this.cores = {};

            // Initialize hyperswarm
            this.logger.info("Initializing Hyperswarm...");
            this.swarm = new Hyperswarm();
            this.swarm.on('connection', (conn) => {
                this.logger.debug("New Hyperswarm connection established");
                if (this.store) {
                    this.store.replicate(conn);
                }
            });
            this.swarm.on('error', (err) => this.logger.error(err, 'Hyperswarm error'));
            this.logger.info("Hyperswarm initialized.");

            // Initialize journal core
            this.logger.info("Initializing journal core...");
            this.journal = await this.store.get({ name: 'journal' });
            await this.journal.ready().catch((err) => this.logger.error("Failed to initialize journal core:", err));
            this.logger.debug("Journal ready:", getCoreInfo(this.journal));
        
            // Check if journal is empty
            const length = await this.journal.length;
            this.logger.debug("Journal length:", length);
    
            if (length === 0) {
                // Journal is empty, generate new UUID and write to first block
                this.logger.debug("Journal is empty, generating new UUID");
                const timestamp = new Date().toISOString();
                this.cellUUID = generateCellUUID(this.settings.name || 'unnamed-cell', timestamp, this.settings);
                this.logger.debug("Generated cell UUID:", this.cellUUID);
    
                // Write UUID info to first block
                const firstBlock = {
                    name: this.settings.name || 'unnamed-cell',
                    timestamp,
                    uuid: this.cellUUID
                };
                await this.journal.append(JSON.stringify(firstBlock));
                this.logger.debug("Wrote UUID info to first block:", firstBlock);
            } else {
                // Journal has blocks, read UUID from first block
                this.logger.debug("Reading UUID from first block");
                const firstBlock = await this.journal.get(0);
                const blockData = JSON.parse(firstBlock.toString());
                this.cellUUID = blockData.uuid;
                this.logger.debug("Read UUID from first block:", this.cellUUID);
            }
            
            // Join journal topic
            this.logger.info("Joining journal topic");
            await this.swarm.join(this.journal.discoveryKey);
    
            // Emit nucleus.started event
            await this.broker.emit("nucleus.started", { 
                cellUUID: this.cellUUID,
                publicKey: this.publicKey
            });    
        } catch (err) {
            this.logger.error("Failed to initialize Corestore:", err);
            this.logger.warn("Service will start without storage capabilities");
            this.store = null;
            this.cores = {};
            this.journal = null;
        }
    }

    async onStopped() {
        this.logger.info("Nucleus service stopping");

        // Emit nucleus.stopped event
        await this.broker.emit("nucleus.stopped", { 
            cellUUID: this.cellUUID,
            publicKey: this.publicKey
        });

        // Close all cores
        if (this.cores) {
            for (const [name, core] of Object.entries(this.cores)) {
                try {
                    await core.close();
                } catch (err) {
                    this.logger.error(`Error closing core ${name}:`, err);
                }
            }
            this.cores = {};
        }

        // Close journal
        if (this.journal) {
            try {
                await this.journal.close();
            } catch (err) {
                this.logger.error("Error closing journal:", err);
            }
            this.journal = null;
        }

        // Destroy swarm
        if (this.swarm) {
            this.logger.info("Destroying swarm");
            try {
                await this.swarm.destroy();
                this.logger.info("Closed swarm");
            } catch (err) {
                this.logger.error("Error destroying swarm:", err);
            }
            this.swarm = null;
        }

        // Close store
        if (this.store) {
            this.logger.info("Closing store");
            try {
                await this.store.close();
                this.logger.info("Closed store");
            } catch (err) {
                this.logger.error("Error closing store:", err);
            }
            this.store = null;
        }
    }

    // Action handlers
    async bind(ctx) {
        const { topic, key } = ctx.params;
        
        try {
            if (!this.store) {
                throw new Error('Store not initialized');
            }

            // No key provided, create new core with topic name
            let core = _.includes(this.cores, topic) ? this.cores[topic] : await this.getCore(topic);

            // Key provided, verify it matches stored core
            if (key && b4a.toString(core.discoveryKey, 'hex') !== key) {
                throw new Error(`Discovery key mismatch for topic ${topic}`);
            }
            
            this.logger.debug({ topic }, "Joining swarm topic with discover key:", core.discoveryKey.toString('hex'));
            const foundPeers = core.findingPeers();
            await this.swarm.join(core.discoveryKey);
            await this.swarm.flush();
            foundPeers();

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
            if (!this.store) {
                throw new Error('Store not initialized');
            }

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
            if (!this.store) {
                throw new Error('Store not initialized');
            }

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

    async read(ctx) {
        const { name, limit = 50, since } = ctx.params;
        
        try {
            if (!this.store) {
                throw new Error('Store not initialized');
            }

            const core = await this.getCore(name);
            const coreLength = await core.length;
            
            // Determine start position
            let startIndex = 0;
            if (since) {
                // Find the first entry after the 'since' timestamp
                for (let i = 0; i < coreLength; i++) {
                    try {
                        const entry = await core.get(i);
                        const data = JSON.parse(entry.toString());
                        const entryTime = new Date(data.timestamp || 0).getTime();
                        if (entryTime > since) {
                            startIndex = i;
                            break;
                        }
                    } catch (parseErr) {
                        // Skip entries that can't be parsed
                        continue;
                    }
                }
            }
            
            // Read entries up to limit
            const entries = [];
            const endIndex = Math.min(startIndex + limit, coreLength);
            
            for (let i = startIndex; i < endIndex; i++) {
                try {
                    const entry = await core.get(i);
                    entries.push({
                        index: i,
                        data: entry.toString()
                    });
                } catch (err) {
                    this.logger.warn(`Failed to read entry ${i} from core ${name}:`, err);
                }
            }

            return {
                name,
                entries,
                startIndex,
                endIndex,
                totalLength: coreLength,
                hasMore: endIndex < coreLength
            };
        } catch (err) {
            this.logger.error("Failed to read from core:", err);  
            throw err;
        }
    }

    async getUUID() {
        if (!this.cellUUID) {
            throw new Error('Cell UUID not yet generated');
        }
        return this.cellUUID;
    }

    async getPublicKey() {
        this.logger.info("Getting public key:\n", this.publicKey);
        if (!this.publicKey) {
            throw new Error('Cell key pair not yet generated');
        }
        return this.publicKey;
    }

    async health() {
        const health = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            cellUUID: this.cellUUID,
            services: {
                store: this.store ? "healthy" : "unavailable",
                swarm: this.swarm ? "healthy" : "unavailable",
                journal: this.journal ? "healthy" : "unavailable"
            },
            metrics: {
                coresCount: this.cores ? Object.keys(this.cores).length : 0,
                journalLength: this.journal ? await this.journal.length : 0
            }
        };

        // Determine overall health status
        const unhealthyServices = Object.values(health.services).filter(status => status !== "healthy");
        if (unhealthyServices.length > 0) {
            health.status = "degraded";
        }

        return health;
    }

    async encryptForCellAction(ctx) {
        const { targetPublicKey, message } = ctx.params;
        return await this.encryptForCell(targetPublicKey, message);
    }

    async decryptFromCellAction(ctx) {
        const { sourcePublicKey, encryptedData } = ctx.params;
        return await this.decryptFromCell(sourcePublicKey, encryptedData);
    }

    async signMessageAction(ctx) {
        const { message } = ctx.params;
        return this.signMessage(message);
    }

    // Helper methods
    async getCore(name, key = undefined, valueEncoding = 'json') {
        if (!this.store) {
            throw new Error('Store not initialized');
        }

        // Get or create the named core
        const core = key ? await this.store.get({ key, valueEncoding }) : await this.store.get({ name, valueEncoding });
        
        // Wait for core to be ready
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Core initialization timeout'));
            }, 5000);

            core.once('ready', () => {
                clearTimeout(timeout);
                resolve();
            });
        });

        this.logger.debug("Hypercore ready:", getCoreInfo(core, name));
        this.cores[name] = core;

        return core;
    }

    async getJournal() {
        if (!this.store) {
            throw new Error('Store not initialized');
        }
        return this.getCore('journal');
    }

    // Helper methods for encryption/signing
    async encryptForCell(targetPublicKey, message) {
        if (!this.privateKey) {
            throw new Error('Cell key pair not yet generated');
        }
        const encrypted = crypto.publicEncrypt(
            {
                key: targetPublicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256"
            },
            Buffer.from(message)
        );
        const signature = this.signMessage(message);
        return {
            encrypted: encrypted.toString('base64'),
            signature
        };
    }

    async decryptFromCell(sourcePublicKey, encryptedData) {
        if (!this.privateKey) {
            throw new Error('Cell key pair not yet generated');
        }
        const { encrypted, signature } = encryptedData;
        const decrypted = crypto.privateDecrypt(
            {
                key: this.privateKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256"
            },
            Buffer.from(encrypted, 'base64')
        ).toString();
        const isValid = this.verifySignature(decrypted, signature, sourcePublicKey);
        if (!isValid) {
            throw new Error('Invalid signature');
        }
        return decrypted;
    }

    signMessage(message) {
        if (!this.privateKey) {
            throw new Error('Cell key pair not yet generated');
        }
        const signer = crypto.createSign('SHA256');
        signer.update(message);
        return signer.sign(this.privateKey, 'base64');
    }

    verifySignature(message, signature, publicKey) {
        const verifier = crypto.createVerify('SHA256');
        verifier.update(message);
        return verifier.verify(publicKey, signature, 'base64');
    }

} 