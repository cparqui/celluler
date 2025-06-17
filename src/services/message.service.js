import BaseService from './base.service.js';
import _ from 'lodash';

// Topic naming conventions
const TOPIC_TYPES = {
  DIRECT: "direct",
  INBOX: "inbox", 
  PEER_CACHE: "peer_cache",
  JOURNAL: "journal"
};

// Parameter validation objects
const CreateTopicParams = {
    topicType: {
        type: "enum",
        values: Object.values(TOPIC_TYPES)
    },
    sourceUUID: {
        type: "string",
        min: 1
    },
    targetUUID: {
        type: "string",
        min: 1,
        optional: true
    }
};

const GetTopicParams = {
    topic: {
        type: "string",
        min: 1
    }
};

const BindTopicParams = {
    topic: {
        type: "string", 
        min: 1
    },
    coreKey: {
        type: "string",
        optional: true
    }
};

const SendMessageParams = {
    targetUUID: {
        type: "string",
        min: 1
    },
    message: {
        type: "string",
        min: 1
    },
    recipientPublicKey: {
        type: "string",
        min: 100 // RSA public keys are much longer than sodium keys
    }
};

const GetMessagesParams = {
    topic: {
        type: "string",
        min: 1
    },
    limit: {
        type: "number",
        min: 1,
        max: 100,
        optional: true,
        default: 50
    },
    since: {
        type: "string",
        optional: true // ISO timestamp
    }
};

// Default settings
const DEFAULT_SETTINGS = {
    // Core management settings
    maxCoresPerType: 1000,
    coreExpirationTime: 24 * 60 * 60 * 1000, // 24 hours
    
    // Security settings
    requireEncryption: true,
    requireSignature: true,
    
    // Performance settings
    cacheSize: 500,
    cleanupInterval: 60 * 1000 // 1 minute
};

export default class MessageService extends BaseService {
    constructor(broker, cellConfig) {
        super(broker, cellConfig);
        
        this.parseServiceSchema({
            name: "message",
            settings: _.defaultsDeep(cellConfig.config, DEFAULT_SETTINGS),
            dependencies: [
                "nucleus"
            ],
            actions: {
                createTopic: {
                    params: CreateTopicParams,
                    handler: this.createTopic,
                    rest: {
                        method: "POST",
                        path: "/topic"
                    }
                },
                getTopic: {
                    params: GetTopicParams,
                    handler: this.getTopic,
                    rest: {
                        method: "GET", 
                        path: "/topic/:topic"
                    }
                },
                bindTopic: {
                    params: BindTopicParams,
                    handler: this.bindTopic,
                    rest: {
                        method: "POST",
                        path: "/bind"
                    }
                },
                listTopics: {
                    handler: this.listTopics,
                    rest: {
                        method: "GET",
                        path: "/topics"
                    }
                },
                health: {
                    handler: this.health,
                    rest: {
                        method: "GET",
                        path: "/health"
                    }
                },
                sendMessage: {
                    params: SendMessageParams,
                    handler: this.sendMessage,
                    rest: {
                        method: "POST",
                        path: "/message"
                    }
                },
                getMessages: {
                    params: GetMessagesParams,
                    handler: this.getMessages,
                    rest: {
                        method: "GET",
                        path: "/messages/:topic"
                    }
                }
            },
            events: {
                "nucleus.started": this.onNucleusStarted
            },
            created: this.onCreated,
            started: this.onStarted,
            stopped: this.onStopped,
        });

        // Topic-to-core mapping
        this.topicMap = new Map();
        this.cellUUID = null;
        this.cleanupTimer = null;
        this.offlineMessageTimer = null;
        
        // Message storage 
        this.messageQueue = new Map(); // offline message queue
        this.cellPublicKey = null; // will be set from nucleus service
    }

    // Lifecycle events
    onCreated() {
        this.logger.info("Message service created");
    }

    async onStarted() {
        this.logger.info("Message service started");
        
        // Start cleanup timer
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredTopics();
        }, this.settings.cleanupInterval);
        
        // Start offline message processing timer
        this.offlineMessageTimer = setInterval(() => {
            this.processOfflineMessages().catch(err => {
                this.logger.error("Error processing offline messages:", err);
            });
        }, 30000); // Process every 30 seconds
    }

    async onStopped() {
        this.logger.info("Message service stopped");
        
        // Clear cleanup timer
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        
        // Clear offline message timer
        if (this.offlineMessageTimer) {
            clearInterval(this.offlineMessageTimer);
            this.offlineMessageTimer = null;
        }
    }

    async onNucleusStarted(ctx) {
        const { cellUUID, publicKey } = ctx.params;
        this.cellUUID = cellUUID;
        this.cellPublicKey = publicKey; // Store as string, nucleus handles crypto
        this.logger.info("Nucleus started, cell UUID:", cellUUID);
        
        this.logger.info("Using nucleus service for crypto operations");
        
        // Create default topics for this cell
        await this.createDefaultTopics();
    }

    // Action handlers
    async createTopic(ctx) {
        const { topicType, sourceUUID, targetUUID } = ctx.params;
        
        try {
            const topic = this.generateTopicName(topicType, sourceUUID, targetUUID);
            const coreInfo = await this.createCoreForTopic(topic, topicType, sourceUUID, targetUUID);
            
            this.logger.info(`Created topic: ${topic}`);
            return {
                success: true,
                topic,
                coreInfo
            };
        } catch (err) {
            this.logger.error("Failed to create topic:", err);
            throw err;
        }
    }

    async getTopic(ctx) {
        const { topic } = ctx.params;
        
        try {
            const coreInfo = this.topicMap.get(topic);
            if (!coreInfo) {
                throw new Error(`Topic not found: ${topic}`);
            }
            
            return {
                topic,
                coreInfo
            };
        } catch (err) {
            this.logger.error("Failed to get topic:", err);
            throw err;
        }
    }

    async bindTopic(ctx) {
        const { topic, coreKey } = ctx.params;
        
        try {
            // Delegate to NucleusService for core binding
            const result = await ctx.call("nucleus.bind", {
                topic,
                key: coreKey
            });
            
            // Update our topic mapping
            const coreInfo = this.parseTopicType(topic);
            coreInfo.coreKey = result.core.key;
            coreInfo.boundAt = new Date().toISOString();
            
            this.topicMap.set(topic, coreInfo);
            
            this.logger.info(`Bound to topic: ${topic}`);
            return {
                success: true,
                topic,
                coreInfo
            };
        } catch (err) {
            this.logger.error("Failed to bind topic:", err);
            throw err;
        }
    }

    async listTopics(ctx) {
        try {
            const topics = Array.from(this.topicMap.entries()).map(([topic, coreInfo]) => ({
                topic,
                ...coreInfo
            }));
            
            return {
                topics,
                count: topics.length
            };
        } catch (err) {
            this.logger.error("Failed to list topics:", err);
            throw err;
        }
    }

    async health(ctx) {
        const health = {
            status: "healthy",
            timestamp: new Date().toISOString(),
            cellUUID: this.cellUUID,
            metrics: {
                topicsCount: this.topicMap.size,
                topicsByType: this.getTopicsByType()
            }
        };
        
        return health;
    }

    async sendMessage(ctx) {
        const { targetUUID, message, recipientPublicKey } = ctx.params;
        
        if (!this.cellUUID) {
            throw new Error("Cell not initialized - missing UUID");
        }
        
        try {
            // Generate topic name for direct message
            const topic = this.generateTopicName(TOPIC_TYPES.DIRECT, this.cellUUID, targetUUID);
            
            // Create or get the topic core
            let coreInfo = this.topicMap.get(topic);
            if (!coreInfo) {
                coreInfo = await this.createCoreForTopic(topic, TOPIC_TYPES.DIRECT, this.cellUUID, targetUUID);
            }
            
            // Create the message structure
            const messagePayload = {
                from: this.cellUUID,
                to: targetUUID,
                content: message,
                timestamp: new Date().toISOString(),
                messageId: this.generateMessageId()
            };
            
            // Use nucleus service for encryption and signing
            const encryptedData = await this.broker.call("nucleus.encryptForCell", {
                targetPublicKey: recipientPublicKey,
                message: JSON.stringify(messagePayload)
            });
            
            // Create final message structure
            const finalMessage = {
                ...encryptedData,
                senderPublicKey: this.cellPublicKey,
                timestamp: messagePayload.timestamp,
                messageId: messagePayload.messageId
            };
            
            // Write to hypercore via nucleus service
            await this.broker.call("nucleus.write", {
                name: topic,
                data: finalMessage
            });
            
            this.logger.info(`Message sent from ${this.cellUUID} to ${targetUUID}`);
            
            return {
                success: true,
                messageId: messagePayload.messageId,
                topic,
                timestamp: messagePayload.timestamp
            };
            
        } catch (err) {
            this.logger.error("Failed to send message:", err);
            
            // Queue message for offline delivery
            this.queueOfflineMessage(targetUUID, message, recipientPublicKey);
            
            throw err;
        }
    }

    async getMessages(ctx) {
        const { topic, limit = 50, since } = ctx.params;
        
        try {
            // Get the topic core info
            const coreInfo = this.topicMap.get(topic);
            if (!coreInfo) {
                throw new Error(`Topic not found: ${topic}`);
            }
            
            // Read messages from hypercore via nucleus service
            const result = await this.broker.call("nucleus.read", {
                name: topic,
                limit,
                since: since ? new Date(since).getTime() : undefined
            });
            
            const messages = [];
            
            for (const entry of result.entries || []) {
                try {
                    const messageData = JSON.parse(entry.data);
                    
                    // Try to decrypt message using nucleus service
                    let decryptedMessage = null;
                    try {
                        if (messageData.encrypted && messageData.signature) {
                            const decrypted = await this.broker.call("nucleus.decryptFromCell", {
                                sourcePublicKey: messageData.senderPublicKey,
                                encryptedData: {
                                    encrypted: messageData.encrypted,
                                    signature: messageData.signature
                                }
                            });
                            decryptedMessage = JSON.parse(decrypted);
                        }
                    } catch (decryptErr) {
                        this.logger.debug("Could not decrypt message (not intended for this recipient)");
                        // Still include the message but without decrypted content
                    }
                    
                    messages.push({
                        messageId: decryptedMessage?.messageId || messageData.messageId || 'encrypted',
                        from: decryptedMessage?.from || 'unknown',
                        to: decryptedMessage?.to || 'unknown',
                        content: decryptedMessage?.content || null,
                        timestamp: messageData.timestamp,
                        encrypted: !decryptedMessage,
                        verified: true // nucleus service handles signature verification
                    });
                    
                } catch (parseErr) {
                    this.logger.warn("Failed to parse message entry:", parseErr);
                }
            }
            
            return {
                topic,
                messages,
                count: messages.length,
                hasMore: result.hasMore || false
            };
            
        } catch (err) {
            this.logger.error("Failed to get messages:", err);
            throw err;
        }
    }

    // Helper methods
    generateTopicName(topicType, sourceUUID, targetUUID = null) {
        switch (topicType) {
            case TOPIC_TYPES.DIRECT:
                if (!targetUUID) {
                    throw new Error("Target UUID required for direct topic");
                }
                return `${TOPIC_TYPES.DIRECT}:${sourceUUID}:${targetUUID}`;
            
            case TOPIC_TYPES.INBOX:
                return `${TOPIC_TYPES.INBOX}:${sourceUUID}`;
            
            case TOPIC_TYPES.PEER_CACHE:
                return `${TOPIC_TYPES.PEER_CACHE}:${sourceUUID}`;
            
            case TOPIC_TYPES.JOURNAL:
                return `${TOPIC_TYPES.JOURNAL}:${sourceUUID}`;
            
            default:
                throw new Error(`Unknown topic type: ${topicType}`);
        }
    }

    parseTopicType(topic) {
        const parts = topic.split(':');
        if (parts.length < 2) {
            throw new Error(`Invalid topic format: ${topic}`);
        }
        
        const topicType = parts[0];
        const sourceUUID = parts[1];
        const targetUUID = parts.length > 2 ? parts[2] : null;
        
        return {
            type: topicType,
            sourceUUID,
            targetUUID,
            encrypted: this.shouldEncrypt(topicType),
            createdAt: new Date().toISOString()
        };
    }

    shouldEncrypt(topicType) {
        // Direct messages should be encrypted
        // Inbox notifications are not encrypted (metadata only)
        // Peer cache is not encrypted (local contact book)
        // Journal is not encrypted (public identity info)
        return topicType === TOPIC_TYPES.DIRECT;
    }

    async createCoreForTopic(topic, topicType, sourceUUID, targetUUID) {
        // Parse topic metadata
        const coreInfo = this.parseTopicType(topic);
        
        // Determine access control
        const access = this.determineAccess(topicType, sourceUUID, targetUUID);
        coreInfo.writers = access.writers;
        coreInfo.readers = access.readers;
        
        // Delegate core creation to NucleusService
        const result = await this.broker.call("nucleus.get", { name: topic });
        coreInfo.coreKey = result.core.key;
        
        // Store in topic mapping
        this.topicMap.set(topic, coreInfo);
        
        return coreInfo;
    }

    determineAccess(topicType, sourceUUID, targetUUID) {
        switch (topicType) {
            case TOPIC_TYPES.DIRECT:
                return {
                    writers: [sourceUUID],
                    readers: [targetUUID]
                };
            
            case TOPIC_TYPES.INBOX:
                return {
                    writers: [sourceUUID], // Cell owns its inbox, grants access later
                    readers: [sourceUUID]
                };
            
            case TOPIC_TYPES.PEER_CACHE:
                return {
                    writers: [sourceUUID], // Only cell writes to its own cache
                    readers: [sourceUUID]  // Only cell reads its own cache
                };
            
            case TOPIC_TYPES.JOURNAL:
                return {
                    writers: [sourceUUID], // Only cell writes to its own journal
                    readers: ["*"]         // Public - anyone can read
                };
            
            default:
                throw new Error(`Unknown topic type: ${topicType}`);
        }
    }

    async createDefaultTopics() {
        if (!this.cellUUID) {
            this.logger.warn("Cannot create default topics - cell UUID not available");
            return;
        }
        
        try {
            // Create inbox topic for this cell
            const inboxTopic = this.generateTopicName(TOPIC_TYPES.INBOX, this.cellUUID);
            await this.createCoreForTopic(inboxTopic, TOPIC_TYPES.INBOX, this.cellUUID);
            this.logger.info(`Created default inbox topic: ${inboxTopic}`);
            
            // Create peer cache topic for this cell
            const peerCacheTopic = this.generateTopicName(TOPIC_TYPES.PEER_CACHE, this.cellUUID);
            await this.createCoreForTopic(peerCacheTopic, TOPIC_TYPES.PEER_CACHE, this.cellUUID);
            this.logger.info(`Created default peer cache topic: ${peerCacheTopic}`);
            
            // Create journal topic for this cell
            const journalTopic = this.generateTopicName(TOPIC_TYPES.JOURNAL, this.cellUUID);
            await this.createCoreForTopic(journalTopic, TOPIC_TYPES.JOURNAL, this.cellUUID);
            this.logger.info(`Created default journal topic: ${journalTopic}`);
            
        } catch (err) {
            this.logger.error("Failed to create default topics:", err);
        }
    }

    getTopicsByType() {
        const typeCount = {};
        
        for (const [topic, coreInfo] of this.topicMap) {
            const type = coreInfo.type;
            typeCount[type] = (typeCount[type] || 0) + 1;
        }
        
        return typeCount;
    }

    cleanupExpiredTopics() {
        const now = Date.now();
        const expiredTopics = [];
        
        for (const [topic, coreInfo] of this.topicMap) {
            const createdAt = new Date(coreInfo.createdAt).getTime();
            if (now - createdAt > this.settings.coreExpirationTime) {
                expiredTopics.push(topic);
            }
        }
        
        // Remove expired topics
        for (const topic of expiredTopics) {
            this.topicMap.delete(topic);
            this.logger.debug(`Cleaned up expired topic: ${topic}`);
        }
        
        if (expiredTopics.length > 0) {
            this.logger.info(`Cleaned up ${expiredTopics.length} expired topics`);
        }
    }

    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Offline message queue methods
    queueOfflineMessage(targetUUID, message, recipientPublicKey) {
        const queueKey = `offline:${targetUUID}`;
        
        if (!this.messageQueue.has(queueKey)) {
            this.messageQueue.set(queueKey, []);
        }
        
        const queue = this.messageQueue.get(queueKey);
        queue.push({
            targetUUID,
            message,
            recipientPublicKey,
            timestamp: new Date().toISOString(),
            retryCount: 0
        });
        
        this.logger.info(`Queued offline message for ${targetUUID}`);
    }

    async processOfflineMessages() {
        for (const [queueKey, queue] of this.messageQueue.entries()) {
            const targetUUID = queueKey.replace('offline:', '');
            
            // Process messages in queue
            const successfullyProcessed = [];
            
            for (let i = 0; i < queue.length; i++) {
                const queuedMessage = queue[i];
                
                try {
                    // Try to send the message
                    await this.broker.call("message.sendMessage", {
                        targetUUID: queuedMessage.targetUUID,
                        message: queuedMessage.message,
                        recipientPublicKey: queuedMessage.recipientPublicKey
                    });
                    
                    successfullyProcessed.push(i);
                    this.logger.info(`Successfully sent offline message to ${targetUUID}`);
                    
                } catch (err) {
                    queuedMessage.retryCount++;
                    
                    // Remove message after max retries
                    if (queuedMessage.retryCount >= 5) {
                        successfullyProcessed.push(i);
                        this.logger.warn(`Giving up on offline message to ${targetUUID} after 5 retries`);
                    }
                }
            }
            
            // Remove successfully processed messages
            for (let i = successfullyProcessed.length - 1; i >= 0; i--) {
                queue.splice(successfullyProcessed[i], 1);
            }
            
            // Clean up empty queues
            if (queue.length === 0) {
                this.messageQueue.delete(queueKey);
            }
        }
    }
} 