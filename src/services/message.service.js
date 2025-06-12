const { Service } = require('moleculer');
const _ = require('lodash');
const Hypercore = require('hypercore');
const ram = require('random-access-memory');

// Parameter validation objects
const MessageSendParams = {
    message: {
        type: "object",
        props: {
            timestamp: { type: "number", convert: true },
            sender: { type: "string", min: 1 },
            receiver: { type: "string", min: 1 },
            type: { 
                type: "enum", 
                values: ["CHAT", "AUTH", "TX", "POST", "QUERY", "EXEC"]
            },
            body: { type: "any" },
            signature: { type: "string", min: 1 },
            proof: { type: "string", min: 1 }
        }
    }
};

const MessageReceiveParams = {
    message: {
        type: "object",
        props: {
            timestamp: { type: "number", convert: true },
            sender: { type: "string", min: 1 },
            receiver: { type: "string", min: 1 },
            type: { 
                type: "enum", 
                values: ["CHAT", "AUTH", "TX", "POST", "QUERY", "EXEC"]
            },
            body: { type: "any" },
            signature: { type: "string", min: 1 },
            proof: { type: "string", min: 1 }
        }
    }
};

// Default settings
const DEFAULT_SETTINGS = {
    // Storage settings
    journalPath: "./data/message",  // Path for message journal
    maxJournalSize: 1024 * 1024 * 1000,  // Maximum journal size in bytes
    
    // Network settings
    timeout: 10000,  // Message timeout in milliseconds
    retryCount: 5,   // Number of delivery retries
    
    // Security settings
    requireSignature: true,  // Require message signatures
    requireProof: true,      // Require identity proofs
    
    // Performance settings
    batchSize: 50,   // Message batch size
    cacheSize: 1000, // Message cache size
    
    // Nested settings
    storage: {
        type: "hypercore",
        options: {
            maxSize: 1024 * 1024 * 1000,
            compression: true
        }
    },
    network: {
        protocol: "tcp",
        options: {
            keepAlive: true,
            timeout: 10000
        }
    }
};

class MessageService extends Service {
    constructor(broker, settings = {}) {
        super(broker, {
            name: "message",
            version: 1,
            settings: _.defaultsDeep(settings, DEFAULT_SETTINGS),
            dependencies: [
                "identity",
                "consensus"
            ],
            actions: {
                send: {
                    params: MessageSendParams,
                    handler: this.sendMessage
                },
                receive: {
                    params: MessageReceiveParams,
                    handler: this.receiveMessage
                },
                getMessages: {
                    params: {
                        limit: { type: "number", optional: true, min: 1, max: 1000 },
                        offset: { type: "number", optional: true, min: 0 }
                    },
                    handler: this.getMessages
                },
                health: {
                    handler: this.health
                }
            },
            events: {
                "message.received": this.onMessageReceived
            }
        });

        // Initialize message journal
        this.journal = null;
    }

    async started() {
        // Initialize Hypercore journal
        this.journal = new Hypercore(ram, {
            valueEncoding: 'json',
            ...this.settings.storage.options
        });

        await this.journal.ready();
        this.logger.info("Message journal initialized");
    }

    async stopped() {
        if (this.journal) {
            await this.journal.close();
        }
    }

    async sendMessage(ctx) {
        const { message } = ctx.params;

        try {
            // Validate message signature and proof
            if (this.settings.requireSignature) {
                const isValid = await ctx.call("identity.verify", {
                    identity: {
                        cellId: message.sender,
                        proof: message.proof
                    }
                });

                if (!isValid.verified) {
                    throw new Error("Invalid message signature or proof");
                }
            }

            // Store message in journal
            await this.journal.append(message);

            // Route message to target cell
            if (message.receiver !== this.broker.nodeID) {
                // TODO: Implement P2P message routing
                this.logger.info(`Routing message to ${message.receiver}`);
            }

            return { success: true, messageId: this.journal.length - 1 };
        } catch (err) {
            this.logger.error("Failed to send message:", err);
            throw err;
        }
    }

    async receiveMessage(ctx) {
        const { message } = ctx.params;

        try {
            // Validate message signature and proof
            if (this.settings.requireSignature) {
                const isValid = await ctx.call("identity.verify", {
                    identity: {
                        cellId: message.sender,
                        proof: message.proof
                    }
                });

                if (!isValid.verified) {
                    throw new Error("Invalid message signature or proof");
                }
            }

            // Store message in journal
            await this.journal.append(message);

            // Emit message received event
            await this.broker.emit("message.received", { message });

            return { success: true, messageId: this.journal.length - 1 };
        } catch (err) {
            this.logger.error("Failed to receive message:", err);
            throw err;
        }
    }

    async getMessages(ctx) {
        const { limit = 100, offset = 0 } = ctx.params;

        try {
            const messages = [];
            const end = Math.min(offset + limit, this.journal.length);

            for (let i = offset; i < end; i++) {
                const message = await this.journal.get(i);
                messages.push(message);
            }

            return {
                messages,
                total: this.journal.length,
                offset,
                limit
            };
        } catch (err) {
            this.logger.error("Failed to get messages:", err);
            throw err;
        }
    }

    async onMessageReceived(ctx) {
        const { message } = ctx.params;
        this.logger.info(`Message received from ${message.sender}:`, message);
    }

    async health(ctx) {
        const health = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            services: {
                journal: this.journal ? "healthy" : "unavailable"
            },
            metrics: {
                journalLength: this.journal ? this.journal.length : 0,
                settings: {
                    requireSignature: this.settings.requireSignature,
                    requireProof: this.settings.requireProof,
                    timeout: this.settings.timeout,
                    retryCount: this.settings.retryCount
                }
            }
        };

        // Determine overall health status
        const unhealthyServices = Object.values(health.services).filter(status => status !== "healthy");
        if (unhealthyServices.length > 0) {
            health.status = "degraded";
        }

        return health;
    }
}

module.exports = MessageService; 